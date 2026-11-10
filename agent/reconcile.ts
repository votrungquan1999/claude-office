import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Collection } from "mongodb";
import { loadKept } from "./kept";
import {
  isRegistryReadable,
  isShownEntry,
  listRegistry,
  pickEntry,
  type RegistryEntry,
} from "./registry";
import type { SessionTracker, TagDoc } from "./tracker";
import { readTranscriptSeed } from "./transcript";
import { EXPIRY_DAYS } from "./writer";

const run = promisify(execFile);

/** One running process: its start time as `ps -o lstart` prints it, and its command line. */
interface ProcessInfo {
  started: string;
  args: string;
}

/** Every running process by pid. */
type ProcessTable = Map<number, ProcessInfo>;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One `ps -o pid=,lstart=,args=` line; a message with newlines in the arguments leaves lines that do not match and are skipped. */
const PROCESS_LINE =
  /^\s*(\d+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s*(.*)$/;

/**
 * Reads every running process in one call.
 * @returns Each pid with its start time and command line.
 */
export async function readProcessTable(): Promise<ProcessTable> {
  const { stdout } = await run(
    "ps",
    ["-ww", "-A", "-o", "pid=,lstart=,args="],
    {
      maxBuffer: 16 * 1024 * 1024,
      // A fixed locale and UTC keep the start time in the format and zone Claude Code records.
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    },
  );
  const table: ProcessTable = new Map();
  for (const line of stdout.split("\n")) {
    const match = PROCESS_LINE.exec(line);
    if (match) {
      table.set(Number(match[1]), {
        started: normalize(match[2]),
        args: match[3].trim(),
      });
    }
  }
  return table;
}

/** `ps -o lstart` in the C locale, e.g. "Mon Nov  6 08:00:00 2026". */
const C_LOCALE_DATE =
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

/** Alive means the pid exists and still belongs to the process the registry recorded (pids get reused). */
export function isRunning(
  process: { pid?: number; procStart?: string },
  table: ProcessTable,
): boolean {
  if (process.pid === undefined) return false;
  const started = table.get(process.pid)?.started;
  if (started === undefined) return false;
  if (process.procStart === undefined) return true;
  const recorded = normalize(process.procStart);
  // A start time in another locale cannot be compared, so such a session is judged by its pid alone.
  return !C_LOCALE_DATE.test(recorded) || recorded === started;
}

/**
 * Takes a registry entry's command line from the process table, when the entry's process is the one running under its pid.
 * @param table - The process table of this pass.
 * @returns A lookup for `listRegistry`.
 */
export function argsFrom(
  table: ProcessTable,
): (entry: RegistryEntry) => string | undefined {
  return (entry) =>
    entry.pid !== undefined && isRunning(entry, table)
      ? table.get(entry.pid)?.args
      : undefined;
}

/**
 * One pass over the tracked sessions against the registry and the process table.
 * @param home - The user's home folder.
 * @param tracker - The tracker holding the sessions.
 */
export async function reconcileSessions(
  home: string,
  tracker: SessionTracker,
): Promise<void> {
  const table = await readProcessTable();
  tracker.reconcile(listRegistry(home, argsFrom(table)), (process) =>
    isRunning(process, table),
  );
}

export interface SeedOptions {
  home: string;
  machineId: string;
  sessions: Collection;
  tracker: SessionTracker;
  now: () => number;
  /** When this Mac last told the database it was alive, read before the first heartbeat of this run. */
  lastSeenAt?: Date;
}

/**
 * Publishes the sessions already running at start-up and sends home every stored session of this
 * Mac that the registry no longer lists.
 * @param options - Where to read, what to write and the clock.
 */
export async function seedRunningSessions(options: SeedOptions): Promise<void> {
  const { home, machineId, sessions, tracker, now, lastSeenAt } = options;
  const table = await readProcessTable();
  const aliveEntries = listRegistry(home, argsFrom(table)).filter(
    (entry) => isShownEntry(entry) && isRunning(entry, table),
  );
  // A session can be listed twice (a resume leaves the old process's entry); it is seeded once, from the newest.
  const alive = [...new Set(aliveEntries.map((entry) => entry.sessionId))].map(
    (sessionId) =>
      pickEntry(
        aliveEntries.filter((entry) => entry.sessionId === sessionId),
      ) as RegistryEntry,
  );
  // Read before seeding: a kept desk must be seeded with its mark or the writer would clear it.
  const keptDesks = await loadKept(sessions, machineId);
  const aliveIds = new Set(alive.map((entry) => entry.sessionId));
  // Tags a previous run stored, so a restart never shrinks them.
  const stored = await sessions
    .find(
      { machineId, sessionId: { $in: alive.map((entry) => entry.sessionId) } },
      { projection: { sessionId: 1, tags: 1, stateSince: 1, state: 1 } },
    )
    .toArray();
  await tracker.seed(
    alive.map((entry) => {
      const transcript = readTranscriptSeed(home, entry.sessionId);
      return {
        sessionId: entry.sessionId,
        cwd: transcript.cwd ?? entry.cwd ?? "",
        // The transcript holds the LAST folder; only the registry knows where the session started.
        startCwd: entry.cwd,
        startedAt: entry.startedAt,
        registryName: entry.name,
        status: entry.status,
        statusUpdatedAt: entry.statusUpdatedAt,
        storedStateSince: stored
          .find((doc) => doc.sessionId === entry.sessionId)
          ?.stateSince?.getTime(),
        storedState: stored.find((doc) => doc.sessionId === entry.sessionId)
          ?.state,
        firstMessage: transcript.firstMessage,
        pasteHead: transcript.pasteHead,
        hadPrompt: transcript.hadPrompt,
        asked: transcript.asked,
        stepDirs: transcript.stepDirs,
        tags: stored
          .find((doc) => doc.sessionId === entry.sessionId)
          ?.tags?.map(({ name, key, parent }: TagDoc) => ({
            name,
            key,
            ...(parent !== undefined ? { parent } : {}),
          })),
        bridgeSessionId: entry.bridgeSessionId ?? transcript.bridgeSessionId,
        kept: keptDesks.find((desk) => desk.sessionId === entry.sessionId)
          ?.kept,
        process: { pid: entry.pid, procStart: entry.procStart },
      };
    }),
  );
  // Sessions found dead ended no later than the last moment the Mac was known to be up.
  const endedAt = new Date(Math.min(now(), lastSeenAt?.getTime() ?? now()));
  // A kept desk whose process is gone stays, shown as not running.
  tracker.seedKept(
    keptDesks.filter((desk) => !aliveIds.has(desk.sessionId)),
    endedAt.getTime(),
  );
  // One batched write for every seeded session.
  await tracker.flush();
  // Without a readable registry nothing can be called missing, so stored sessions stay as they are.
  if (!isRegistryReadable(home)) return;
  await sessions.updateMany(
    {
      machineId,
      endedAt: { $exists: false },
      sessionId: { $nin: [...aliveIds, ...keptDesks.map((d) => d.sessionId)] },
    },
    {
      $set: {
        state: "wentHome",
        stateSince: endedAt,
        endedAt,
        expireAt: new Date(endedAt.getTime() + EXPIRY_DAYS * 86_400_000),
      },
      $currentDate: { changedAt: true },
    },
  );
}
