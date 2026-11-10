import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ObjectId } from "mongodb";
import {
  firstRealMessage,
  isPasteOnly,
  resolveDeskName,
} from "../src/shared/desk-name";
import { type HookEvent, hookEventSchema } from "../src/shared/hook-events";
import type { SessionState } from "../src/shared/session-state";
import type { FolderRecorder } from "./folders";
import type { KanbanCard } from "./kanban-watch";
import type { PasteNamer } from "./paste-namer";
import {
  findRegistryEntry,
  isRegistryReadable,
  isShownEntry,
  type RegistryEntry,
} from "./registry";
import {
  RepoLookupError,
  type RepoResolver,
  type ResolvedRepo,
} from "./repo-resolver";
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
import { readTranscriptSeed } from "./transcript";
import type { SessionWriter, StepDoc } from "./writer";

/** What the registry and the transcript know about a session that was running before the agent started. */
export interface SeedSession {
  sessionId: string;
  cwd: string;
  /** The registry's folder for the session, which a later `cd` never changes. */
  startCwd?: string;
  startedAt?: number;
  registryName?: string;
  status?: "idle" | "busy" | "waiting";
  /** When the registry last changed `status`. */
  statusUpdatedAt?: number;
  /** The `stateSince` a previous run stored, used when the registry gives no status time. */
  storedStateSince?: number;
  /** The state a previous run stored, which says whether `storedStateSince` still applies. */
  storedState?: SessionState;
  firstMessage?: string;
  /** The start of the paste when the first message was only a paste. */
  pasteHead?: string;
  hadPrompt: boolean;
  bridgeSessionId?: string;
  /** The newest turn, already ended, asked the owner something. */
  asked?: boolean;
  process?: { pid?: number; procStart?: string };
  /** Repos the session worked in, as stored on a previous run (never shrinks). */
  tags?: TagDoc[];
  /** Folders its transcript says it worked in, resolved to repos before the session is published. */
  stepDirs?: string[];
}

/** A repo tag as stored and sent: a display name, an opaque key and the parent folder's name, never a path. */
export interface TagDoc {
  name: string;
  key: string;
  /** Absent on tags stored before it existed. */
  parent?: string;
}

export interface TrackerOptions {
  home: string;
  machineId: string;
  machineName: string;
  reorderMs: number;
  now: () => number;
  writer: SessionWriter;
  /** Records each start folder; absent in tests that do not need it. */
  folders?: FolderRecorder;
  /** Finds the repo of a step folder; absent in tests that do not need tags. */
  repos?: RepoResolver;
  /** Names paste-only desks; absent when the owner set no Anthropic key. */
  pasteNamer?: PasteNamer;
}

interface Tracked {
  buffer: HookEvent[];
  timer?: NodeJS.Timeout;
  cwd?: string;
  /** Where the session started: the registry's folder, else the first main-thread event's. */
  startCwd?: string;
  cwdHookTs: number;
  bridgeSessionId?: string;
  bridgeHookTs: number;
  startedAt?: number;
  interactive: boolean;
  firstMessage?: string;
  /** The start of the paste when the first message was only a paste; held in memory only, until Haiku has answered. */
  pasteHead?: string;
  /** The name Haiku (or the Mac's cache) gave a paste-only session. */
  pasteName?: string;
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
  /** `hookTs` of the newest event applied, to tell stragglers. */
  lastHookTs: number;
  /** `hookTs` of the newest event that changed the state; a registry status only overrides hooks older than itself. */
  stateHookTs: number;
  /** The process behind the session, as the registry last recorded it. */
  process?: { pid?: number; procStart?: string };
  /** Repos worked in so far; only grows. */
  tags: TagDoc[];
  /** Set while the owner keeps the session at its desk (hired from the office). */
  kept?: "hired" | "woken";
  /** The room last published (Working and Thinking are one), to tell when the session changes room. */
  publishedRoom?: string;
  /** When the session entered `publishedRoom`, by the Mac's clock. */
  stateSince?: number;
}

/**
 * The room a published state puts a session in, for telling a room change from a wording change.
 * @param state - The published state.
 * @returns The state, with Thinking counted as Working.
 */
function roomOf(state: SessionState): string {
  return state === "thinking" ? "working" : state;
}

/**
 * The real path of a folder, so it compares with the paths git reports.
 * @param path - A folder, which may be gone.
 * @returns The resolved path, or the input when it cannot be resolved.
 */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
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
  /** Repo lookups still running; `flush` waits for them and `stop` drops them. */
  private readonly pending = new Set<Promise<void>>();
  /** Paste-name requests still running; only `settleNames` waits for them, so a slow Anthropic never delays the seed. */
  private readonly naming = new Set<Promise<void>>();
  private stopped = false;

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
   * @returns Once their repo tags are resolved and the sessions are handed to the writer.
   */
  async seed(seeds: SeedSession[]): Promise<void> {
    for (const seed of seeds) {
      const tracked = this.track(seed.sessionId);
      tracked.interactive = true;
      tracked.process = seed.process;
      tracked.cwd = seed.cwd;
      tracked.startCwd = seed.startCwd;
      tracked.startedAt = seed.startedAt;
      tracked.registryName = seed.registryName;
      tracked.firstMessage = seed.firstMessage;
      tracked.pasteHead = seed.pasteHead;
      tracked.hadPrompt = seed.hadPrompt;
      tracked.bridgeSessionId = seed.bridgeSessionId;
      // A question only counts for a session the registry calls idle; busy and waiting say the turn goes on.
      tracked.memory = applyRegistryStatus(
        initialStateMemory(seed.asked && (seed.status ?? "idle") === "idle"),
        seed.status ?? "idle",
      );
      tracked.tags = [...(seed.tags ?? [])];
      // A restart keeps the registry's own time in the status, so long-running sessions do not read 0s.
      tracked.publishedRoom = roomOf(tracked.memory.state);
      const sameRoom =
        seed.storedState !== undefined &&
        roomOf(seed.storedState) === tracked.publishedRoom;
      tracked.stateSince =
        seed.statusUpdatedAt ??
        (sameRoom ? seed.storedStateSince : undefined) ??
        this.options.now();
    }
    // Tags are resolved before anything is published, so a restart never publishes tag-less sessions.
    await Promise.all(
      seeds.flatMap((seed) =>
        (seed.stepDirs ?? []).map((dir) =>
          this.lookUp(seed.sessionId, this.track(seed.sessionId), dir, false),
        ),
      ),
    );
    for (const seed of seeds) {
      this.publish(seed.sessionId, this.track(seed.sessionId));
    }
  }

  /**
   * Tracks a session the office just opened in a Terminal window, so its desk appears once Claude Code registers it.
   * @param hire - The session, its start folder and when its window opened.
   */
  trackHired(hire: {
    sessionId: string;
    folder: string;
    launchedAt: number;
  }): void {
    const tracked = this.track(hire.sessionId);
    tracked.cwd = hire.folder;
    tracked.startCwd = hire.folder;
    tracked.startedAt = hire.launchedAt;
    tracked.kept = "hired";
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
      // A hidden `claude -p` run of the same conversation must not lend its name, folder or link to the desk.
      const entry = entries.find(
        (candidate) =>
          candidate.sessionId === sessionId && isShownEntry(candidate),
      );
      const process = entry
        ? { pid: entry.pid, procStart: entry.procStart }
        : tracked.process;
      tracked.process = process;
      // A `--resume` elsewhere gives the registry a new start folder.
      if (entry?.cwd && entry.cwd !== tracked.startCwd) {
        tracked.startCwd = entry.cwd;
        this.publish(sessionId, tracked);
      }
      // A /rename after the session appeared only reaches the registry file.
      if (entry && entry.name !== tracked.registryName) {
        tracked.registryName = entry.name;
        this.publish(sessionId, tracked);
      }
      // The registry is the source of truth for the Remote Control link.
      if (entry && entry.bridgeSessionId !== tracked.bridgeSessionId) {
        tracked.bridgeSessionId = entry.bridgeSessionId;
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
        (entry.statusUpdatedAt ?? -Infinity) > tracked.stateHookTs
      ) {
        // Idle after a turn the hooks never saw end: the transcript tail says whether it ended on a question.
        const turnEnded =
          entry.status === "idle" && tracked.memory.base === "thinking";
        tracked.memory = turnEnded
          ? initialStateMemory(
              readTranscriptSeed(this.options.home, sessionId).asked,
            )
          : applyRegistryStatus(tracked.memory, entry.status);
        // The registry knows when the status changed; publish() would stamp the room with now.
        const room = roomOf(tracked.memory.state);
        if (tracked.endedAt === undefined && tracked.publishedRoom !== room) {
          tracked.publishedRoom = room;
          tracked.stateSince = entry.statusUpdatedAt ?? this.options.now();
        }
        this.publish(sessionId, tracked);
      }
    }
  }

  /** A held session goes when the registry says it is not interactive, or it has been silent too long to still be waiting for its entry. */
  private shouldEvictHeld(sessionId: string, tracked: Tracked): boolean {
    if (tracked.interactive || tracked.timer || tracked.kept) return false;
    const entry = findRegistryEntry(this.options.home, sessionId);
    if (entry) return !isShownEntry(entry);
    // Without a registry the hooks alone show the session, so only an ended one can go.
    if (!isRegistryReadable(this.options.home) && tracked.endedAt === undefined)
      return false;
    return this.options.now() - tracked.lastActivityAt > HELD_TTL_MS;
  }

  /** Applies every buffered event now and waits for the writes to land. */
  async flush(): Promise<void> {
    for (const sessionId of this.sessions.keys()) this.drain(sessionId);
    // Events applied while waiting can add lookups, so wait until none is left; each republishes its session.
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    await this.options.folders?.flush();
    await this.options.writer.flush();
  }

  /** Waits for every paste-name request, then publishes and writes what they named. */
  async settleNames(): Promise<void> {
    while (this.naming.size > 0) await Promise.all([...this.naming]);
    await this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.options.pasteNamer?.stop();
    this.pending.clear();
    this.naming.clear();
    for (const tracked of this.sessions.values()) clearTimeout(tracked.timer);
  }

  private track(sessionId: string): Tracked {
    let tracked = this.sessions.get(sessionId);
    if (!tracked) {
      tracked = {
        buffer: [],
        lastActivityAt: this.options.now(),
        lastHookTs: -Infinity,
        stateHookTs: -Infinity,
        cwdHookTs: -Infinity,
        bridgeHookTs: -Infinity,
        interactive: false,
        hadPrompt: false,
        memory: initialStateMemory(),
        steps: initialStepMemory(),
        unwritten: [],
        tags: [],
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
    // A hidden run resuming a conversation must not bring its desk back or be counted as the employee.
    if (!tracked.interactive || tracked.endedAt !== undefined) {
      const entry = findRegistryEntry(this.options.home, event.session_id);
      if (entry && !isShownEntry(entry)) return;
    }
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
    if (!event.agent_id && event.cwd) tracked.startCwd ??= event.cwd;
    if (!event.agent_id && event.cwd && event.hookTs >= tracked.cwdHookTs) {
      tracked.cwd = event.cwd;
      tracked.cwdHookTs = event.hookTs;
    }
    // Claude Code often leaves the id out of the hook env, so an event without it says nothing; the registry clears it on reconcile.
    if (event.bridgeSessionId && event.hookTs >= tracked.bridgeHookTs) {
      tracked.bridgeSessionId = event.bridgeSessionId;
      tracked.bridgeHookTs = event.hookTs;
    }
    // Main thread and subagents both count: a subagent may work in its own worktree.
    const stepDir = event.tool_input?.file_dir ?? event.cwd;
    if (stepDir) this.lookUp(event.session_id, tracked, stepDir, true);
    if (event.hook_event_name === "UserPromptSubmit") tracked.hadPrompt = true;
    if (event.hook_event_name === "UserPromptSubmit" && !tracked.firstMessage) {
      tracked.firstMessage = firstRealMessage(event.prompt ?? "");
      // The hook forwards the head of any paste; only a paste-only message is named from it.
      tracked.pasteHead = isPasteOnly(event.prompt ?? "")
        ? event.paste_head
        : undefined;
    }
    const next = late
      ? reduceLate(tracked.memory, event)
      : reduceState(tracked.memory, event);
    // An event that left the memory untouched (an idle prompt) must not outrank a newer registry status.
    if (next !== tracked.memory) {
      tracked.stateHookTs = Math.max(tracked.stateHookTs, event.hookTs);
    }
    tracked.memory = next;
    this.addSteps(tracked, event.session_id, reduceSteps(tracked.steps, event));
    if (event.hook_event_name === "SessionEnd") {
      tracked.endedAt = this.options.now();
      tracked.endedHookTs = event.hookTs;
    }
  }

  /**
   * Finds the repo of a step folder and adds it to the session's tags unless it is, or wraps, the start folder's repo.
   * @param sessionId - The session.
   * @param tracked - Its state.
   * @param dir - The step folder.
   * @param republish - Whether a new tag publishes the session at once.
   */
  private lookUp(
    sessionId: string,
    tracked: Tracked,
    dir: string,
    republish: boolean,
  ): Promise<void> {
    const { repos } = this.options;
    const task = (async () => {
      if (!repos) return;
      const start = tracked.startCwd ?? tracked.cwd;
      let repo: ResolvedRepo | undefined;
      let startRepo: ResolvedRepo | undefined;
      const startReal = start ? realpathOrSelf(start) : undefined;
      try {
        repo = await repos.resolve(dir);
        if (repo && startReal) startRepo = await repos.resolve(startReal);
      } catch (error) {
        // Git could not answer; tagging now could name the main checkout of the start folder's own repo, so a later event retries.
        if (error instanceof RepoLookupError) return;
        throw error;
      }
      if (!repo || !startReal) return;
      if (startRepo?.path === repo.path) return;
      if (startReal === repo.path || startReal.startsWith(`${repo.path}/`)) {
        return;
      }
      const key = createHash("sha256")
        .update(repo.path)
        .digest("hex")
        .slice(0, 12);
      if (tracked.tags.some((tag) => tag.key === key)) return;
      tracked.tags.push({
        name: repo.name,
        key,
        parent: basename(dirname(repo.path)),
      });
      if (republish && !this.stopped) this.publish(sessionId, tracked);
    })().finally(() => this.pending.delete(task));
    this.pending.add(task);
    return task;
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

  /**
   * The Haiku name for a paste-only session shown on the office, asking for it once when it is not known yet.
   * @param sessionId - The session.
   * @param tracked - Its state; only an interactive session with a paste head is asked about.
   * @param card - Its AI-Kanban card; a card name covers the desk, so no call is made.
   * @returns The known name, if any.
   */
  private pasteNameFor(
    sessionId: string,
    tracked: Tracked,
    card: KanbanCard | undefined,
  ): string | undefined {
    const { pasteNamer } = this.options;
    if (tracked.pasteName) return tracked.pasteName;
    if (!pasteNamer || !tracked.pasteHead) return undefined;
    if (card?.summary?.trim() || card?.title?.trim()) return undefined;
    const known = pasteNamer.nameOf(sessionId);
    // An answer, even a cached final failure, means the paste text is never needed again.
    if (pasteNamer.hasAnswer(sessionId)) tracked.pasteHead = undefined;
    if (known) {
      tracked.pasteName = known;
      return known;
    }
    // A desk that went home is not worth a call.
    if (tracked.endedAt !== undefined || !tracked.pasteHead) return undefined;
    const task = pasteNamer.ask(sessionId, tracked.pasteHead);
    if (!task) return undefined;
    const tracking: Promise<void> = task
      .then(() => {
        if (this.stopped) return;
        // The paste text is no longer needed once the call returned.
        tracked.pasteName = pasteNamer.nameOf(sessionId);
        tracked.pasteHead = undefined;
        this.publish(sessionId, tracked);
      })
      .finally(() => this.naming.delete(tracking));
    this.naming.add(tracking);
    return undefined;
  }

  private publish(sessionId: string, tracked: Tracked): void {
    if (!tracked.interactive) {
      // A session with no registry entry yet is held and re-checked on its next event.
      const entry = findRegistryEntry(this.options.home, sessionId);
      if (entry && isShownEntry(entry)) {
        tracked.interactive = true;
        tracked.startedAt = entry.startedAt ?? tracked.startedAt;
        tracked.registryName = entry.name;
        if (entry.cwd) tracked.startCwd = entry.cwd;
        tracked.bridgeSessionId = entry.bridgeSessionId;
        tracked.process = { pid: entry.pid, procStart: entry.procStart };
      } else if (entry || isRegistryReadable(this.options.home)) {
        return;
      }
      // With no readable registry the kind is unknown, so the hooks alone decide that the session shows.
    }
    if (!tracked.cwd || tracked.startedAt === undefined) return;
    const { machineId, machineName, writer } = this.options;
    const card = this.cards.get(sessionId);
    const pasteName = this.pasteNameFor(sessionId, tracked, card);
    const deskName = resolveDeskName({
      cardSummary: card?.summary,
      cardTitle: card?.title,
      pasteName,
      firstMessage: tracked.firstMessage,
      registryName: tracked.registryName,
    });
    this.options.folders?.record(tracked.startCwd ?? tracked.cwd);
    const steps = tracked.unwritten;
    tracked.unwritten = [];
    // Compared on the published state: a went-home session keeps its memory state.
    const state: SessionState =
      tracked.endedAt === undefined ? tracked.memory.state : "wentHome";
    if (tracked.publishedRoom !== roomOf(state)) {
      tracked.publishedRoom = roomOf(state);
      tracked.stateSince = tracked.endedAt ?? this.options.now();
    }
    writer.submit(
      {
        machineId,
        machineName,
        sessionId,
        cwd: tracked.cwd,
        startCwd: tracked.startCwd ?? tracked.cwd,
        state,
        stateSince: new Date(tracked.stateSince ?? this.options.now()),
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
        ...(tracked.tags.length ? { tags: tracked.tags } : {}),
        hadPrompt: tracked.hadPrompt,
        ...(tracked.kept ? { kept: tracked.kept } : {}),
      },
      steps,
    );
  }
}
