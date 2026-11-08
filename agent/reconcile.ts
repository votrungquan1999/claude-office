import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Collection } from "mongodb";
import { isRegistryReadable, listRegistry } from "./registry";
import type { SessionTracker } from "./tracker";
import { readTranscriptSeed } from "./transcript";
import { EXPIRY_DAYS } from "./writer";

const run = promisify(execFile);

/** Start times by pid, as `ps -o lstart` prints them. */
type ProcessTable = Map<number, string>;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Reads every running process in one call.
 * @returns Each pid with its start time.
 */
export async function readProcessTable(): Promise<ProcessTable> {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,lstart="], {
    maxBuffer: 16 * 1024 * 1024,
    // A fixed locale and UTC keep the start time in the format and zone Claude Code records.
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  const table: ProcessTable = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) table.set(Number(match[1]), normalize(match[2]));
  }
  return table;
}

/** `ps -o lstart` in the C locale, e.g. "Mon Nov  6 08:00:00 2026". */
const C_LOCALE_DATE =
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

/** Alive means the pid exists and still belongs to the process the registry recorded (pids get reused). */
function isRunning(
  process: { pid?: number; procStart?: string },
  table: ProcessTable,
): boolean {
  if (process.pid === undefined) return false;
  const started = table.get(process.pid);
  if (started === undefined) return false;
  if (process.procStart === undefined) return true;
  const recorded = normalize(process.procStart);
  // A start time in another locale cannot be compared, so such a session is judged by its pid alone.
  return !C_LOCALE_DATE.test(recorded) || recorded === started;
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
  tracker.reconcile(listRegistry(home), (process) => isRunning(process, table));
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
  const alive = listRegistry(home).filter(
    (entry) => entry.kind === "interactive" && isRunning(entry, table),
  );
  tracker.seed(
    alive.map((entry) => {
      const transcript = readTranscriptSeed(home, entry.sessionId);
      return {
        sessionId: entry.sessionId,
        cwd: transcript.cwd ?? entry.cwd ?? "",
        startedAt: entry.startedAt,
        registryName: entry.name,
        status: entry.status,
        firstMessage: transcript.firstMessage,
        hadPrompt: transcript.hadPrompt,
        bridgeSessionId: entry.bridgeSessionId ?? transcript.bridgeSessionId,
        process: { pid: entry.pid, procStart: entry.procStart },
      };
    }),
  );
  // One batched write for every seeded session.
  await tracker.flush();
  // Without a readable registry nothing can be called missing, so stored sessions stay as they are.
  if (!isRegistryReadable(home)) return;
  // Sessions found dead ended no later than the last moment the Mac was known to be up.
  const endedAt = new Date(Math.min(now(), lastSeenAt?.getTime() ?? now()));
  await sessions.updateMany(
    {
      machineId,
      endedAt: { $exists: false },
      sessionId: { $nin: alive.map((entry) => entry.sessionId) },
    },
    {
      $set: {
        state: "wentHome",
        endedAt,
        expireAt: new Date(endedAt.getTime() + EXPIRY_DAYS * 86_400_000),
      },
      $currentDate: { changedAt: true },
    },
  );
}
