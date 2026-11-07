import { ObjectId } from "mongodb";
import { firstRealMessage, resolveDeskName } from "../src/shared/desk-name";
import { type HookEvent, hookEventSchema } from "../src/shared/hook-events";
import type { KanbanCard } from "./kanban-watch";
import { findRegistryEntry } from "./registry";
import {
  initialStateMemory,
  reduceState,
  type StateMemory,
} from "./session-state";
import { initialStepMemory, reduceSteps, type StepMemory } from "./steps";
import type { SessionWriter, StepDoc } from "./writer";

export interface TrackerOptions {
  home: string;
  machineId: string;
  machineName: string;
  reorderMs: number;
  now: () => number;
  writer: SessionWriter;
}

interface Tracked {
  buffer: HookEvent[];
  timer?: NodeJS.Timeout;
  cwd?: string;
  cwdHookTs: number;
  bridgeSessionId?: string;
  bridgeHookTs: number;
  startedAt?: number;
  interactive: boolean;
  firstMessage?: string;
  hadPrompt: boolean;
  registryName?: string;
  memory: StateMemory;
  steps: StepMemory;
  /** Finished steps not yet handed to the writer. */
  unwritten: StepDoc[];
  endedAt?: number;
  endedHookTs?: number;
}

/**
 * Turns hook events into session snapshots: applies them in `hookTs` order after a short reorder
 * window, ignores stragglers of an ended session, and publishes interactive sessions only.
 */
export class SessionTracker {
  private readonly sessions = new Map<string, Tracked>();
  private readonly cards = new Map<string, KanbanCard>();

  constructor(private readonly options: TrackerOptions) {}

  /**
   * Accepts one event from the hook; anything that is not a valid allowlisted event is dropped.
   * @param raw - The parsed JSON body.
   */
  ingest(raw: unknown): void {
    const parsed = hookEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    const tracked = this.track(event.session_id);
    tracked.buffer.push(event);
    if (tracked.timer) return;
    tracked.timer = setTimeout(
      () => this.drain(event.session_id),
      this.options.reorderMs,
    );
    tracked.timer.unref();
  }

  /**
   * Records the AI-Kanban card of a session (or its removal) and republishes the session.
   * @param sessionId - The session the card belongs to.
   * @param card - The card, or undefined when its file is gone.
   */
  setCard(sessionId: string, card: KanbanCard | undefined): void {
    if (card) this.cards.set(sessionId, card);
    else this.cards.delete(sessionId);
    const tracked = this.sessions.get(sessionId);
    if (tracked) this.publish(sessionId, tracked);
  }

  /** Applies every buffered event now and waits for the writes to land. */
  async flush(): Promise<void> {
    for (const sessionId of this.sessions.keys()) this.drain(sessionId);
    await this.options.writer.flush();
  }

  stop(): void {
    for (const tracked of this.sessions.values()) clearTimeout(tracked.timer);
  }

  private track(sessionId: string): Tracked {
    let tracked = this.sessions.get(sessionId);
    if (!tracked) {
      tracked = {
        buffer: [],
        cwdHookTs: -Infinity,
        bridgeHookTs: -Infinity,
        interactive: false,
        hadPrompt: false,
        memory: initialStateMemory(),
        steps: initialStepMemory(),
        unwritten: [],
      };
      this.sessions.set(sessionId, tracked);
    }
    return tracked;
  }

  private drain(sessionId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    clearTimeout(tracked.timer);
    tracked.timer = undefined;
    const events = tracked.buffer.sort((a, b) => a.hookTs - b.hookTs);
    tracked.buffer = [];
    for (const event of events) this.apply(tracked, event);
    this.publish(sessionId, tracked);
  }

  private apply(tracked: Tracked, event: HookEvent): void {
    const starting = event.hook_event_name === "SessionStart";
    if (tracked.endedHookTs !== undefined) {
      // Only a newer SessionStart (resume) reopens; anything else is a straggler from before the end.
      if (!starting || event.hookTs <= tracked.endedHookTs) return;
      tracked.endedAt = undefined;
      tracked.endedHookTs = undefined;
    }
    tracked.startedAt ??= event.hookTs;
    // Only the main thread sets the folder (a subagent may run in its own worktree); a late event never moves it back past a newer one.
    if (!event.agent_id && event.cwd && event.hookTs >= tracked.cwdHookTs) {
      tracked.cwd = event.cwd;
      tracked.cwdHookTs = event.hookTs;
    }
    // The id is only in the hook's env while Remote Control is connected, so the newest event decides, absent included.
    if (event.hookTs >= tracked.bridgeHookTs) {
      tracked.bridgeSessionId = event.bridgeSessionId;
      tracked.bridgeHookTs = event.hookTs;
    }
    if (event.hook_event_name === "UserPromptSubmit") tracked.hadPrompt = true;
    if (event.hook_event_name === "UserPromptSubmit" && !tracked.firstMessage) {
      tracked.firstMessage = firstRealMessage(event.prompt ?? "");
    }
    tracked.memory = reduceState(tracked.memory, event);
    for (const step of reduceSteps(tracked.steps, event)) {
      tracked.unwritten.push({
        _id: new ObjectId(),
        machineId: this.options.machineId,
        sessionId: event.session_id,
        ...step,
        startedAt: new Date(step.startedAt),
      });
    }
    if (event.hook_event_name === "SessionEnd") {
      tracked.endedAt = this.options.now();
      tracked.endedHookTs = event.hookTs;
    }
  }

  private publish(sessionId: string, tracked: Tracked): void {
    if (!tracked.interactive) {
      // A session with no registry entry yet is held and re-checked on its next event.
      const entry = findRegistryEntry(this.options.home, sessionId);
      if (entry?.kind !== "interactive") return;
      tracked.interactive = true;
      tracked.startedAt = entry.startedAt ?? tracked.startedAt;
      tracked.registryName = entry.name;
    }
    if (!tracked.cwd || tracked.startedAt === undefined) return;
    const { machineId, machineName, writer } = this.options;
    const card = this.cards.get(sessionId);
    const deskName = resolveDeskName({
      cardSummary: card?.summary,
      cardTitle: card?.title,
      firstMessage: tracked.firstMessage,
      registryName: tracked.registryName,
    });
    const steps = tracked.unwritten;
    tracked.unwritten = [];
    writer.submit(
      {
        machineId,
        machineName,
        sessionId,
        cwd: tracked.cwd,
        state:
          tracked.endedAt === undefined ? tracked.memory.state : "wentHome",
        startedAt: new Date(tracked.startedAt),
        ...(deskName ? { deskName } : {}),
        ...(tracked.bridgeSessionId
          ? { bridgeSessionId: tracked.bridgeSessionId }
          : {}),
        ...(tracked.endedAt === undefined
          ? {}
          : { endedAt: new Date(tracked.endedAt) }),
        runningSteps: [...tracked.steps.running.values()].map((step) => ({
          text: step.text,
          startedAt: new Date(step.startedAt),
        })),
        currentTodo: tracked.steps.todo,
        hadPrompt: tracked.hadPrompt,
      },
      steps,
    );
  }
}
