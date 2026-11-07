import { ObjectId } from "mongodb";
import { firstRealMessage, resolveDeskName } from "../src/shared/desk-name";
import { type HookEvent, hookEventSchema } from "../src/shared/hook-events";
import type { KanbanCard } from "./kanban-watch";
import {
  findRegistryEntry,
  isRegistryReadable,
  type RegistryEntry,
} from "./registry";
import {
  applyRegistryStatus,
  initialStateMemory,
  reduceLate,
  reduceState,
  type StateMemory,
} from "./session-state";
import {
  closeRunning,
  type FinishedStep,
  initialStepMemory,
  reduceSteps,
  type StepMemory,
} from "./steps";
import type { SessionWriter, StepDoc } from "./writer";

/** What the registry and the transcript know about a session that was running before the agent started. */
export interface SeedSession {
  sessionId: string;
  cwd: string;
  startedAt?: number;
  registryName?: string;
  status?: "idle" | "busy" | "waiting";
  firstMessage?: string;
  hadPrompt: boolean;
  bridgeSessionId?: string;
  process?: { pid?: number; procStart?: string };
}

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
  /** Wall-clock time of the newest event received, for evicting held sessions. */
  lastActivityAt: number;
  /** `hookTs` of the newest event applied; a registry status only overrides hooks older than itself. */
  lastHookTs: number;
  /** The process behind the session, as the registry last recorded it. */
  process?: { pid?: number; procStart?: string };
}

/** Finished steps kept per session while nothing has been written; older ones are dropped. */
const MAX_UNWRITTEN_STEPS = 500;
/** How long a session that never became interactive is kept after its last event. */
const HELD_TTL_MS = 10 * 60_000;

/** Tells whether the process the registry recorded is still the one running. */
export type IsRunning = (process: {
  pid?: number;
  procStart?: string;
}) => boolean;

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
    tracked.lastActivityAt = this.options.now();
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

  /**
   * Publishes sessions that were already running, which no hook event announced.
   * @param seeds - Interactive sessions that are alive.
   */
  seed(seeds: SeedSession[]): void {
    for (const seed of seeds) {
      const tracked = this.track(seed.sessionId);
      tracked.interactive = true;
      tracked.process = seed.process;
      tracked.cwd = seed.cwd;
      tracked.startedAt = seed.startedAt;
      tracked.registryName = seed.registryName;
      tracked.firstMessage = seed.firstMessage;
      tracked.hadPrompt = seed.hadPrompt;
      tracked.bridgeSessionId = seed.bridgeSessionId;
      tracked.memory = applyRegistryStatus(
        initialStateMemory(),
        seed.status ?? "idle",
      );
      this.publish(seed.sessionId, tracked);
    }
  }

  /**
   * Corrects what hooks could not see: a session whose process is gone goes home, and a fresher registry status replaces a stale state.
   * @param entries - The registry as it is now.
   * @param isRunning - Whether a recorded process is still the one running.
   */
  reconcile(entries: RegistryEntry[], isRunning: IsRunning): void {
    for (const [sessionId, tracked] of this.sessions) {
      if (!tracked.interactive) {
        // A held session is re-checked here too: its registry entry may have appeared since its last event.
        this.publish(sessionId, tracked);
        if (this.shouldEvictHeld(sessionId, tracked)) {
          clearTimeout(tracked.timer);
          this.sessions.delete(sessionId);
        }
        continue;
      }
      if (tracked.endedAt !== undefined) continue;
      const entry = entries.find(
        (candidate) => candidate.sessionId === sessionId,
      );
      const process = entry
        ? { pid: entry.pid, procStart: entry.procStart }
        : tracked.process;
      tracked.process = process;
      // A /rename after the session appeared only reaches the registry file.
      if (entry && entry.name !== tracked.registryName) {
        tracked.registryName = entry.name;
        this.publish(sessionId, tracked);
      }
      // /clear gives the same process a new session id without a SessionEnd for the old one.
      const known = tracked.process;
      const replaced =
        !entry &&
        known?.pid !== undefined &&
        known.procStart !== undefined &&
        entries.some(
          (other) =>
            other.pid === known.pid && other.procStart === known.procStart,
        );
      // A resumed session whose process is not listed yet cannot be judged; the next pass will.
      if (!process && !replaced) continue;
      if (replaced || !process || !isRunning(process)) {
        tracked.endedAt = this.options.now();
        tracked.endedHookTs = this.options.now();
        // Nothing will report the tools that were mid-run when the process vanished.
        this.addSteps(tracked, sessionId, closeRunning(tracked.steps));
        this.publish(sessionId, tracked);
        continue;
      }
      // Claude Code's own status wins only when it is newer than anything the hooks said.
      if (
        entry?.status &&
        (entry.statusUpdatedAt ?? -Infinity) > tracked.lastHookTs
      ) {
        tracked.memory = applyRegistryStatus(tracked.memory, entry.status);
        this.publish(sessionId, tracked);
      }
    }
  }

  /** A held session goes when the registry says it is not interactive, or it has been silent too long to still be waiting for its entry. */
  private shouldEvictHeld(sessionId: string, tracked: Tracked): boolean {
    if (tracked.interactive || tracked.timer) return false;
    const entry = findRegistryEntry(this.options.home, sessionId);
    if (entry) return entry.kind !== "interactive";
    // Without a registry the hooks alone show the session, so only an ended one can go.
    if (!isRegistryReadable(this.options.home) && tracked.endedAt === undefined)
      return false;
    return this.options.now() - tracked.lastActivityAt > HELD_TTL_MS;
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
        lastActivityAt: this.options.now(),
        lastHookTs: -Infinity,
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
      // A resume may run in a new process; the old pid is dead, so the new one is learned from the registry.
      const entry = findRegistryEntry(this.options.home, event.session_id);
      tracked.process = entry
        ? { pid: entry.pid, procStart: entry.procStart }
        : undefined;
    }
    tracked.startedAt ??= event.hookTs;
    // A straggler stamped before an event already applied must not move the state back.
    const late = event.hookTs < tracked.lastHookTs;
    tracked.lastHookTs = Math.max(tracked.lastHookTs, event.hookTs);
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
    tracked.memory = late
      ? reduceLate(tracked.memory, event)
      : reduceState(tracked.memory, event);
    this.addSteps(tracked, event.session_id, reduceSteps(tracked.steps, event));
    if (event.hook_event_name === "SessionEnd") {
      tracked.endedAt = this.options.now();
      tracked.endedHookTs = event.hookTs;
    }
  }

  private addSteps(
    tracked: Tracked,
    sessionId: string,
    steps: FinishedStep[],
  ): void {
    for (const step of steps) {
      tracked.unwritten.push({
        _id: new ObjectId(),
        machineId: this.options.machineId,
        sessionId,
        ...step,
        startedAt: new Date(step.startedAt),
      });
    }
    // Bounded so a session that is never written cannot grow without limit.
    if (tracked.unwritten.length > MAX_UNWRITTEN_STEPS) {
      tracked.unwritten.splice(
        0,
        tracked.unwritten.length - MAX_UNWRITTEN_STEPS,
      );
    }
  }

  private publish(sessionId: string, tracked: Tracked): void {
    if (!tracked.interactive) {
      // A session with no registry entry yet is held and re-checked on its next event.
      const entry = findRegistryEntry(this.options.home, sessionId);
      if (entry?.kind === "interactive") {
        tracked.interactive = true;
        tracked.startedAt = entry.startedAt ?? tracked.startedAt;
        tracked.registryName = entry.name;
        tracked.process = { pid: entry.pid, procStart: entry.procStart };
      } else if (entry || isRegistryReadable(this.options.home)) {
        return;
      }
      // With no readable registry the kind is unknown, so the hooks alone decide that the session shows.
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
