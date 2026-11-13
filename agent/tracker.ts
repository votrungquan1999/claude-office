import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ObjectId } from "mongodb";
import {
  firstRealMessage,
  isPasteOnly,
  pasteHeadOf,
  requestOf,
  resolveDeskName,
} from "../src/shared/desk-name";
import { type HookEvent, hookEventSchema } from "../src/shared/hook-events";
import type { SessionState } from "../src/shared/session-state";
import type { FolderRecorder } from "./folders";
import type { KanbanCard } from "./kanban-watch";
import type { StoredKept, StoredSession } from "./kept";
import {
  findRegistryEntry,
  isRegistryReadable,
  isShownEntry,
  pickEntry,
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
  setTurnResult,
} from "./session-state";
import {
  closeRunning,
  type FinishedStep,
  initialStepMemory,
  reduceSteps,
  type StepMemory,
} from "./steps";
import type { TaskNamer } from "./task-namer";
import { readTranscriptSeed } from "./transcript";
import type { TurnClassifier } from "./turn-classifier";
import { strongerResult, type TurnResult } from "./turn-result";
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
  /** The state a previous run stored: a finished one is kept on restart, and it says whether `storedStateSince` still applies. */
  storedState?: SessionState;
  firstMessage?: string;
  /** The start of the paste when the first message was only a paste. */
  pasteHead?: string;
  /** The original request: the typed first message, up to 2,000 characters. */
  request?: string;
  hadPrompt: boolean;
  bridgeSessionId?: string;
  /** What the newest turn, already ended, left for the owner. */
  result?: TurnResult;
  /** That turn's last answer, checked with Haiku when the owner set a key. */
  answer?: string;
  process?: { pid?: number; procStart?: string };
  /** Repos the session worked in, as stored on a previous run (never shrinks). */
  tags?: TagDoc[];
  /** The keep-at-desk mark a previous run stored. */
  kept?: "hired" | "woken";
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
  /** Writes short task names; absent when the owner set no Anthropic key. */
  taskNamer?: TaskNamer;
  /** Decides with Haiku whether a finished answer asks the owner to reply; absent when the owner set no Anthropic key. */
  turnClassifier?: TurnClassifier;
  /** Told when a kept window's mark moves to another conversation. */
  onKeptMoved?: (fromId: string, toId: string) => void;
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
  /** The original request: the typed first message, up to 2,000 characters. */
  request?: string;
  /** The short task name Haiku (or the Mac's cache) gave the session. */
  taskName?: string;
  /** Undefined while unknown: a conversation resumed from an earlier agent run keeps the stored value. */
  hadPrompt?: boolean;
  registryName?: string;
  memory: StateMemory;
  steps: StepMemory;
  /** Finished steps not yet handed to the writer. */
  unwritten: StepDoc[];
  endedAt?: number;
  endedHookTs?: number;
  /** Wall-clock time of the newest event received, for evicting held sessions. */
  lastActivityAt: number;
  /** Counts every change to the turn state, so a late Haiku verdict can tell its turn is still the current one. */
  epoch: number;
  /** What the plain rule found for the turn's Stops, before the classifier downgrade; a follow-up Stop carries it. */
  plainResult: TurnResult;
  /** `hookTs` of the newest event applied, to tell stragglers. */
  lastHookTs: number;
  /** `hookTs` of the newest event that changed the state; a registry status only overrides hooks older than itself. */
  stateHookTs: number;
  /** The process behind the session, as the registry last recorded it. */
  process?: { pid?: number; procStart?: string };
  /** Repos worked in so far; only grows. */
  tags: TagDoc[];
  /** Set while the owner keeps the session at its desk. */
  kept?: "hired" | "woken";
  /** Set from the moment the office opens the window until Claude Code registers: whether it waits at the trust question or is just starting. */
  launchWait?: "waiting" | "starting";
  /** Set by a restart that could not read the registry: whether the window still runs is unknown until the registry can be read. */
  unverified?: boolean;
  /** When the office opened the window `launchWait` is waiting on, by the Mac's clock. */
  launchedAt?: number;
  /** The name a previous run stored, used until a better one is known. */
  storedDeskName?: string;
  /** The room last published (Working and Thinking are one), to tell when the session changes room. */
  publishedRoom?: string;
  /** When the session entered `publishedRoom`, by the Mac's clock. */
  stateSince?: number;
}

/**
 * What a seeded session's stored state says its finished turn left, when the stored state is a finished one.
 * @param seed - The session being seeded.
 * @returns The stored result, whatever the transcript tail says. Undefined when the stored state was a busy one or missing.
 */
function storedResult(seed: SeedSession): TurnResult | undefined {
  const stored: string | undefined = seed.storedState;
  if (stored === undefined) return undefined;
  if (stored === "waitingForYou") return "asks";
  if (stored === "review") return "reports";
  // "waiting" is the old name of Idle.
  return stored === "idle" || stored === "waiting" ? "nothing" : undefined;
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
 * The state a desk publishes.
 * @param tracked - The desk's state.
 * @param launching - What a window the office opened is waiting on, when it has not registered yet.
 * @param notRunning - Whether a kept desk's process has ended.
 * @returns A window waiting at the Mac or starting, a kept desk that stopped, a went-home session, or the live state.
 */
function publishedState(
  tracked: Tracked,
  launching: Tracked["launchWait"],
  notRunning: boolean,
): SessionState {
  if (launching) return launching === "waiting" ? "needsPermission" : "idle";
  if (notRunning) return "idle";
  return tracked.endedAt === undefined ? tracked.memory.state : "wentHome";
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
/** How long a window the office opened may go without a registry entry or hook before its desk shows Not running. */
const LAUNCH_WAIT_LIMIT_MS = 30 * 60_000;

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
  /** Turn-end checks still waiting for Haiku. */
  private readonly checking = new Set<Promise<void>>();
  private stopped = false;
  /** The liveness check of the latest reconcile pass, so lookups outside it also prefer a live entry. */
  private isRunning?: IsRunning;

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
      tracked.request = seed.request;
      tracked.hadPrompt = seed.hadPrompt;
      tracked.bridgeSessionId = seed.bridgeSessionId;
      tracked.kept = seed.kept;
      // A result only counts for a session the registry calls idle; busy and waiting say the turn goes on.
      const idle = (seed.status ?? "idle") === "idle";
      // A turn that already ended before this run keeps its stored state; only a turn that was still going gets sorted now.
      const storedTurn = idle ? storedResult(seed) : undefined;
      tracked.memory = applyRegistryStatus(
        initialStateMemory(
          idle
            ? (storedTurn ?? this.firstResult(seed.result ?? "nothing"))
            : "nothing",
        ),
        seed.status ?? "idle",
      );
      tracked.tags = [...(seed.tags ?? [])];
      if (idle && storedTurn === undefined) {
        this.checkTurnEnd(
          seed.sessionId,
          tracked,
          seed.answer,
          seed.result ?? "nothing",
          "nothing",
        );
      }
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
   * Restores kept desks that no live registry entry matches: closed windows as idle desks marked not running, and windows that never registered as waiting or starting again.
   * @param desks - The stored kept desks.
   * @param endedAt - When their processes are taken to have ended, for desks not already marked.
   */
  seedKept(desks: StoredKept[], endedAt: number): void {
    for (const desk of desks) {
      const tracked = this.track(desk.sessionId);
      // A window that never registered keeps waiting for its registry entry instead of showing as closed.
      tracked.interactive = desk.launchWait === undefined;
      tracked.launchWait = desk.launchWait;
      tracked.kept = desk.kept;
      tracked.cwd = desk.cwd;
      tracked.startCwd = desk.startCwd;
      tracked.startedAt = desk.startedAt.getTime();
      tracked.hadPrompt = desk.hadPrompt;
      tracked.tags = [...desk.tags];
      tracked.storedDeskName = desk.deskName;
      this.seedFirstMessage(tracked, desk.sessionId);
      // The row's room time is when the window opened, since a launching desk's room never changes.
      if (desk.launchWait !== undefined) {
        tracked.launchedAt = (desk.stateSince ?? desk.startedAt).getTime();
        if (desk.stateSince) {
          tracked.publishedRoom =
            desk.launchWait === "waiting" ? "needsPermission" : "idle";
          tracked.stateSince = desk.stateSince.getTime();
        }
      }
      if (
        desk.launchWait === undefined &&
        isRegistryReadable(this.options.home)
      ) {
        tracked.endedAt = endedAt;
        tracked.endedHookTs = endedAt;
      } else if (desk.launchWait === undefined) {
        // No entry can be called missing without a readable registry, so the desk keeps running until a pass can tell.
        tracked.unverified = true;
      }
      // A desk already marked keeps the time its window closed.
      if (desk.notRunning && desk.stateSince) {
        tracked.publishedRoom = "notRunning";
        tracked.stateSince = desk.stateSince.getTime();
      }
      this.publish(desk.sessionId, tracked);
    }
  }

  /**
   * Tracks a session the office just opened in a Terminal window and publishes its desk as waiting at the Mac or starting.
   * @param hire - The session, its start folder, when its window opened, its first message and whether the folder is trusted.
   */
  trackHired(hire: {
    sessionId: string;
    folder: string;
    launchedAt: number;
    /** The first message, used only to name the desk. */
    message: string;
    /** Whether Claude Code trusts the folder; undefined when the Mac cannot tell. */
    trusted: boolean | undefined;
  }): void {
    const tracked = this.track(hire.sessionId);
    tracked.cwd = hire.folder;
    tracked.startCwd = hire.folder;
    tracked.startedAt = hire.launchedAt;
    tracked.launchedAt = hire.launchedAt;
    tracked.kept = "hired";
    // An unknown trust is shown as waiting: a window stopped at the question is the one thing the owner must act on.
    tracked.launchWait = hire.trusted === true ? "starting" : "waiting";
    tracked.firstMessage = firstRealMessage(hire.message);
    tracked.request = requestOf(hire.message);
    tracked.pasteHead = pasteHeadOf(hire.message);
    this.publish(hire.sessionId, tracked);
  }

  /**
   * Brings a conversation back to its desk in a window the office just opened, waiting at the Mac or starting.
   * @param wake - The conversation, its start folder, when its window opened, whether the folder is trusted, and its stored row when this run has not tracked it.
   */
  trackWoken(wake: {
    sessionId: string;
    folder: string;
    launchedAt: number;
    trusted: boolean | undefined;
    stored?: StoredSession;
  }): void {
    const known = this.sessions.has(wake.sessionId);
    const tracked = this.track(wake.sessionId);
    if (known) {
      // The old process is gone; the window about to register is a new one.
      this.reopen(tracked);
      tracked.process = undefined;
      tracked.publishedRoom = undefined;
    } else {
      const { stored } = wake;
      tracked.cwd = stored?.cwd ?? wake.folder;
      tracked.startCwd = stored?.startCwd ?? wake.folder;
      tracked.startedAt = stored?.startedAt.getTime() ?? wake.launchedAt;
      tracked.hadPrompt = stored?.hadPrompt;
      tracked.tags = [...(stored?.tags ?? [])];
      tracked.storedDeskName = stored?.deskName;
      this.seedFirstMessage(tracked, wake.sessionId);
    }
    tracked.interactive = false;
    tracked.launchedAt = wake.launchedAt;
    tracked.kept = "woken";
    tracked.launchWait = wake.trusted === true ? "starting" : "waiting";
    this.publish(wake.sessionId, tracked);
  }

  /**
   * Whether a window the office opened for the session has not registered yet.
   * @param sessionId - The session.
   * @returns True while its desk is waiting at the Mac or starting.
   */
  isLaunching(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.launchWait !== undefined;
  }

  /**
   * Stops keeping a session at its desk: a desk with nothing running behind it goes home now, a running one when its process ends.
   * @param sessionId - The kept session.
   */
  clearKept(sessionId: string): void {
    const tracked = this.sessions.get(sessionId);
    if (!tracked?.kept) return;
    const wasWoken = tracked.kept === "woken";
    tracked.kept = undefined;
    const entry =
      tracked.launchWait !== undefined ? this.entryOf(sessionId) : undefined;
    if (
      entry &&
      isShownEntry(entry) &&
      (!wasWoken || this.isRunning?.(entry) === true)
    ) {
      // The window started before the next registry pass saw it, so the desk is running and only loses its mark.
      this.adoptEntry(tracked, entry);
    } else if (tracked.launchWait !== undefined) {
      // No process registered, so nothing runs behind the desk; clearing the wait is what lets a later wake pass `isLaunching`.
      tracked.launchWait = undefined;
      tracked.interactive = true;
      tracked.endedAt = this.options.now();
    } else if (tracked.endedAt !== undefined) {
      // The went-home time is the dismiss, not when the window closed.
      tracked.endedAt = this.options.now();
      tracked.endedHookTs = undefined;
    }
    this.publish(sessionId, tracked);
  }

  /**
   * Corrects what hooks could not see: a session whose process is gone goes home, and a fresher registry status replaces a stale state.
   * @param entries - The registry as it is now.
   * @param isRunning - Whether a recorded process is still the one running.
   */
  reconcile(entries: RegistryEntry[], isRunning: IsRunning): void {
    this.isRunning = isRunning;
    for (const [sessionId, tracked] of this.sessions) {
      if (!tracked.interactive) {
        // A held session is re-checked here too: its registry entry may have appeared since its last event.
        this.publish(sessionId, tracked);
        this.giveUpLaunch(sessionId, tracked);
        if (this.shouldEvictHeld(sessionId, tracked)) {
          clearTimeout(tracked.timer);
          this.sessions.delete(sessionId);
        }
        continue;
      }
      if (tracked.endedAt !== undefined) {
        this.readopt(sessionId, tracked, entries, isRunning);
        continue;
      }
      // A hidden `claude -p` run of the same conversation must not lend its name, folder or link to the desk.
      const entry = pickEntry(
        entries.filter(
          (candidate) =>
            candidate.sessionId === sessionId && isShownEntry(candidate),
        ),
        (candidate) => isRunning(candidate),
      );
      const process = entry
        ? { pid: entry.pid, procStart: entry.procStart }
        : tracked.process;
      tracked.process = process;
      // The first readable registry settles a desk the restart could not judge.
      if (tracked.unverified && isRegistryReadable(this.options.home)) {
        tracked.unverified = undefined;
        if (!entry) {
          tracked.endedAt = this.options.now();
          tracked.endedHookTs = this.options.now();
          this.publish(sessionId, tracked);
          continue;
        }
      }
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
      // A kept window that switches conversation keeps its desk; only the conversation it ran ends.
      if (replaced && tracked.kept && known) {
        const next = entries.find(
          (other) =>
            other.pid === known.pid && other.procStart === known.procStart,
        );
        if (next) this.moveKept(sessionId, tracked, next);
      }
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
        // Idle after a turn the hooks never saw end: the transcript tail sorts how it ended.
        const turnEnded =
          entry.status === "idle" && tracked.memory.base === "thinking";
        const ended = turnEnded
          ? readTranscriptSeed(this.options.home, sessionId)
          : undefined;
        tracked.epoch += 1;
        tracked.memory = ended
          ? initialStateMemory(this.firstResult(ended.result))
          : applyRegistryStatus(tracked.memory, entry.status);
        if (ended) {
          this.checkTurnEnd(
            sessionId,
            tracked,
            ended.answer,
            ended.result,
            "nothing",
          );
        }
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

  /**
   * Restores the first message of a conversation this run never saw start, so the next prompt does not rename its desk.
   * @param tracked - The session's state.
   * @param sessionId - The session.
   */
  private seedFirstMessage(tracked: Tracked, sessionId: string): void {
    const transcript = readTranscriptSeed(this.options.home, sessionId);
    tracked.firstMessage = transcript.firstMessage;
    tracked.pasteHead = transcript.pasteHead;
    tracked.request = transcript.request;
  }

  /**
   * Turns a window that never started Claude Code into a Not running desk once its wait is over.
   * @param sessionId - The session.
   * @param tracked - Its state.
   */
  private giveUpLaunch(sessionId: string, tracked: Tracked): void {
    if (
      tracked.interactive ||
      tracked.launchWait === undefined ||
      tracked.launchedAt === undefined ||
      this.options.now() - tracked.launchedAt <= LAUNCH_WAIT_LIMIT_MS
    ) {
      return;
    }
    tracked.launchWait = undefined;
    tracked.interactive = true;
    tracked.endedAt = this.options.now();
    // No end hook time, so any later SessionStart brings the desk back.
    tracked.endedHookTs = undefined;
    this.publish(sessionId, tracked);
  }

  /**
   * Brings a kept desk that shows Not running back to running when a live shown registry entry of another process has its id.
   * @param sessionId - The session.
   * @param tracked - Its state.
   * @param entries - The registry as it is now.
   * @param isRunning - Whether a recorded process is still the one running.
   */
  private readopt(
    sessionId: string,
    tracked: Tracked,
    entries: RegistryEntry[],
    isRunning: IsRunning,
  ): void {
    if (!tracked.kept) return;
    const entry = pickEntry(
      entries.filter(
        (candidate) =>
          candidate.sessionId === sessionId &&
          isShownEntry(candidate) &&
          isRunning(candidate) &&
          // The process whose end hook just fired may still be listed for a moment; only another process is a resume.
          !(
            candidate.pid === tracked.process?.pid &&
            candidate.procStart === tracked.process?.procStart
          ),
      ),
    );
    if (!entry) return;
    this.adoptEntry(tracked, entry);
    this.reopen(tracked, entry.status ?? "idle");
    this.publish(sessionId, tracked);
  }

  /**
   * Brings an ended desk back: no end time, a fresh state and no hook judged yet.
   * @param tracked - The desk's state.
   * @param status - The status a registry entry reports; absent when no entry speaks for the new process yet.
   */
  private reopen(tracked: Tracked, status?: RegistryEntry["status"]): void {
    tracked.endedAt = undefined;
    tracked.endedHookTs = undefined;
    tracked.memory = status
      ? applyRegistryStatus(initialStateMemory(), status)
      : initialStateMemory();
    tracked.stateHookTs = -Infinity;
  }

  private entryOf(sessionId: string): RegistryEntry | undefined {
    const { isRunning } = this;
    return findRegistryEntry(
      this.options.home,
      sessionId,
      isRunning && ((entry) => isRunning(entry)),
    );
  }

  /**
   * Hands a kept window's mark to the conversation its process now runs.
   * @param fromId - The conversation the mark was on.
   * @param from - Its state.
   * @param entry - The registry entry the process now has.
   */
  private moveKept(fromId: string, from: Tracked, entry: RegistryEntry): void {
    const untracked = !this.sessions.has(entry.sessionId);
    const to = this.track(entry.sessionId);
    if (untracked) to.hadPrompt = undefined;
    to.interactive = true;
    to.kept = from.kept;
    to.process = { pid: entry.pid, procStart: entry.procStart };
    to.registryName = entry.name;
    to.bridgeSessionId = entry.bridgeSessionId;
    to.cwd ??= entry.cwd ?? from.cwd;
    to.startCwd ??= entry.cwd ?? from.startCwd;
    to.startedAt ??= entry.startedAt ?? this.options.now();
    // A resume into a session that had gone home brings its desk back, in the state the registry reports.
    if (to.endedAt !== undefined) this.reopen(to, entry.status ?? "idle");
    from.kept = undefined;
    this.options.onKeptMoved?.(fromId, entry.sessionId);
    this.publish(entry.sessionId, to);
  }

  /** A held session goes when the registry says it is not interactive, or it has been silent too long to still be waiting for its entry. */
  private shouldEvictHeld(sessionId: string, tracked: Tracked): boolean {
    if (tracked.interactive || tracked.timer || tracked.kept) return false;
    const entry = this.entryOf(sessionId);
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
    while (this.naming.size > 0 || this.checking.size > 0) {
      await Promise.all([...this.naming, ...this.checking]);
    }
    await this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.options.taskNamer?.stop();
    this.options.turnClassifier?.stop();
    this.pending.clear();
    this.naming.clear();
    this.checking.clear();
    for (const tracked of this.sessions.values()) clearTimeout(tracked.timer);
  }

  private track(sessionId: string): Tracked {
    let tracked = this.sessions.get(sessionId);
    if (!tracked) {
      tracked = {
        buffer: [],
        lastActivityAt: this.options.now(),
        epoch: 0,
        plainResult: "nothing",
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
      const entry = this.entryOf(event.session_id);
      if (entry && !isShownEntry(entry)) return;
    }
    if (tracked.endedAt !== undefined) {
      // Only a newer SessionStart (resume) reopens; anything else is a straggler from before the end. A dismiss leaves no end hook time, so any SessionStart reopens.
      if (
        !starting ||
        (tracked.endedHookTs !== undefined &&
          event.hookTs <= tracked.endedHookTs)
      ) {
        return;
      }
      tracked.endedAt = undefined;
      tracked.endedHookTs = undefined;
      // A resume may run in a new process; the old pid is dead, so the new one is learned from the registry.
      const entry = this.entryOf(event.session_id);
      tracked.process = entry
        ? { pid: entry.pid, procStart: entry.procStart }
        : undefined;
      // The old window's link is dead; the new process's own id arrives from the registry or a later hook.
      tracked.bridgeSessionId = entry?.bridgeSessionId;
      tracked.bridgeHookTs = -Infinity;
    }
    // With no readable registry the window's own hooks are the only proof it started; a woken desk ignores hooks older than its window, which belong to the old process.
    if (
      tracked.launchWait &&
      !tracked.interactive &&
      (starting || event.hook_event_name === "UserPromptSubmit") &&
      (tracked.kept !== "woken" ||
        event.hookTs > (tracked.launchedAt ?? Number.POSITIVE_INFINITY)) &&
      !isRegistryReadable(this.options.home)
    ) {
      tracked.launchWait = undefined;
      tracked.interactive = true;
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
      tracked.request = requestOf(event.full_prompt ?? event.prompt ?? "");
      // The hook forwards the head of any paste; only a paste-only message is named from it.
      tracked.pasteHead = isPasteOnly(event.prompt ?? "")
        ? event.paste_head
        : undefined;
    }
    const next = late
      ? reduceLate(tracked.memory, event)
      : reduceState(tracked.memory, event);
    if (!late && !event.agent_id) tracked.epoch += 1;
    // A new prompt starts a new turn, so an earlier turn's result no longer carries.
    if (
      !late &&
      !event.agent_id &&
      event.hook_event_name === "UserPromptSubmit"
    ) {
      tracked.plainResult = "nothing";
    }
    // An event that left the memory untouched (an idle prompt) must not outrank a newer registry status.
    if (next !== tracked.memory) {
      tracked.stateHookTs = Math.max(tracked.stateHookTs, event.hookTs);
    }
    tracked.memory = next;
    if (!late && !event.agent_id && event.hook_event_name === "Stop") {
      // A follow-up Stop keeps an earlier result of the turn, outside the first-result downgrade.
      const carried: TurnResult =
        event.stop_hook_active === true ? tracked.plainResult : "nothing";
      tracked.plainResult = strongerResult(tracked.memory.result, carried);
      // With a classifier, Idle shows first and its REPORTS answer promotes the desk to Review.
      tracked.memory = setTurnResult(
        tracked.memory,
        strongerResult(this.firstResult(tracked.memory.result), carried),
      );
      this.checkTurnEnd(
        event.session_id,
        tracked,
        event.last_assistant_message,
        tracked.plainResult,
        carried,
      );
    }
    this.addSteps(tracked, event.session_id, reduceSteps(tracked.steps, event));
    if (event.hook_event_name === "SessionEnd") {
      tracked.endedAt = this.options.now();
      tracked.endedHookTs = event.hookTs;
    }
  }

  /**
   * The result a desk shows before Haiku has answered.
   * @param result - What the plain rule found.
   * @returns With a classifier, a plain result shows as nothing (Idle) and Haiku promotes it; without one it stands.
   */
  private firstResult(result: TurnResult): TurnResult {
    return this.options.turnClassifier && result === "reports"
      ? "nothing"
      : result;
  }

  /**
   * Asks Haiku what the ended turn left for the owner and corrects the desk when it answers.
   * The desk is already published with its first result (with a key, a plain answer shows as Idle); a failed call falls back to the plain rule's result, and no key or a newer event leaves it as it is.
   * @param sessionId - The session.
   * @param tracked - Its state, whose turn has just ended.
   * @param answer - The turn's last answer.
   * @param plain - What the plain rule found for the turn.
   * @param carried - The result of an earlier Stop of the same turn; a follow-up Stop keeps it when it is stronger.
   */
  private checkTurnEnd(
    sessionId: string,
    tracked: Tracked,
    answer: string | undefined,
    plain: TurnResult,
    carried: TurnResult,
  ): void {
    const { turnClassifier } = this.options;
    if (!turnClassifier || !answer?.trim()) return;
    const epoch = tracked.epoch;
    const check: Promise<void> = turnClassifier
      .classify(sessionId, answer)
      .then((verdict) => {
        if (
          this.stopped ||
          tracked.epoch !== epoch ||
          tracked.endedAt !== undefined
        ) {
          return;
        }
        // An outage or a bad answer must not hide finished work, so the plain rule stands in.
        const result = strongerResult(verdict ?? plain, carried);
        if (result === tracked.memory.result) return;
        tracked.memory = setTurnResult(tracked.memory, result);
        this.publish(sessionId, tracked);
      })
      .finally(() => this.checking.delete(check));
    this.checking.add(check);
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
   * The Haiku task name for a session shown on the office, asking for it once when it is not known yet.
   * @param sessionId - The session.
   * @param tracked - Its state; only a session with a request is asked about.
   * @param card - Its AI-Kanban card; a card name covers the desk, so no call is made.
   * @returns The known name, if any.
   */
  private taskNameFor(
    sessionId: string,
    tracked: Tracked,
    card: KanbanCard | undefined,
  ): string | undefined {
    const { taskNamer } = this.options;
    if (tracked.taskName) return tracked.taskName;
    const input = tracked.request ?? tracked.pasteHead;
    if (!taskNamer || !input) return undefined;
    if (card?.summary?.trim() || card?.title?.trim()) return undefined;
    const known = taskNamer.nameOf(sessionId);
    // An answer, even a cached final failure, means the paste text is never needed again.
    if (taskNamer.hasAnswer(sessionId)) tracked.pasteHead = undefined;
    if (known) {
      tracked.taskName = known;
      return known;
    }
    // A desk that went home is not worth a call.
    if (tracked.endedAt !== undefined) return undefined;
    const task = taskNamer.ask(sessionId, input);
    if (!task) return undefined;
    const tracking: Promise<void> = task
      .then(() => {
        if (this.stopped) return;
        // The paste text is no longer needed once the call returned.
        tracked.pasteHead = undefined;
        tracked.taskName = taskNamer.nameOf(sessionId);
        this.publish(sessionId, tracked);
      })
      .finally(() => this.naming.delete(tracking));
    this.naming.add(tracking);
    return undefined;
  }

  private adoptEntry(tracked: Tracked, entry: RegistryEntry): void {
    tracked.interactive = true;
    tracked.startedAt = entry.startedAt ?? tracked.startedAt;
    tracked.registryName = entry.name;
    if (entry.cwd) tracked.startCwd = entry.cwd;
    tracked.bridgeSessionId = entry.bridgeSessionId;
    tracked.process = { pid: entry.pid, procStart: entry.procStart };
    tracked.launchWait = undefined;
  }

  private publish(sessionId: string, tracked: Tracked): void {
    if (!tracked.interactive) {
      // A session with no registry entry yet is held and re-checked on its next event.
      const entry = this.entryOf(sessionId);
      // A woken conversation keeps the dead entry of its old process, so only a live one means the new window registered.
      const registered =
        entry &&
        isShownEntry(entry) &&
        (tracked.kept !== "woken" ||
          !tracked.launchWait ||
          this.isRunning?.(entry) === true);
      if (entry && registered) {
        this.adoptEntry(tracked, entry);
      } else if (
        !tracked.launchWait &&
        (entry || isRegistryReadable(this.options.home))
      ) {
        return;
      }
      // A launching desk shows from its launch record; with no readable registry the hooks alone decide that the session shows.
    }
    if (!tracked.cwd || tracked.startedAt === undefined) return;
    const { machineId, machineName, writer } = this.options;
    const card = this.cards.get(sessionId);
    const taskName = this.taskNameFor(sessionId, tracked, card);
    const deskName = resolveDeskName({
      cardSummary: card?.summary,
      cardTitle: card?.title,
      taskName,
      firstMessage: tracked.firstMessage,
      registryName: tracked.registryName ?? tracked.storedDeskName,
    });
    this.options.folders?.record(tracked.startCwd ?? tracked.cwd);
    const steps = tracked.unwritten;
    tracked.unwritten = [];
    // A kept employee whose process ended stays at its desk instead of going home.
    const notRunning =
      tracked.endedAt !== undefined && tracked.kept !== undefined;
    // A window the office opened is not a session yet: it waits at the trust question or is still starting.
    const launching = tracked.interactive ? undefined : tracked.launchWait;
    // Compared on the published state: a went-home session keeps its memory state.
    const state = publishedState(tracked, launching, notRunning);
    const room = notRunning ? "notRunning" : roomOf(state);
    if (tracked.publishedRoom !== room) {
      tracked.publishedRoom = room;
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
        ...(tracked.request ? { request: tracked.request } : {}),
        ...(tracked.bridgeSessionId && !notRunning
          ? { bridgeSessionId: tracked.bridgeSessionId }
          : {}),
        ...(tracked.endedAt === undefined || notRunning
          ? {}
          : { endedAt: new Date(tracked.endedAt) }),
        runningSteps: notRunning
          ? []
          : [...tracked.steps.running.values()].map((step) => ({
              text: step.text,
              startedAt: new Date(step.startedAt),
            })),
        currentTodo: notRunning ? undefined : tracked.steps.todo,
        ...(tracked.tags.length ? { tags: tracked.tags } : {}),
        ...(tracked.hadPrompt === undefined
          ? {}
          : { hadPrompt: tracked.hadPrompt }),
        ...(tracked.kept ? { kept: tracked.kept } : {}),
        ...(notRunning ? { notRunning: true as const } : {}),
        ...(launching === "waiting" ? { waitingAtMac: true as const } : {}),
        ...(launching === "starting" ? { starting: true as const } : {}),
      },
      steps,
    );
  }
}
