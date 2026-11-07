import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { ensureIndexes } from "../src/db/indexes";
import { readComputerName } from "./computer-name";
import {
  type AgentFile,
  officeDir,
  readAgentFile,
  readMachineId,
  writeAgentFile,
} from "./config";
import { startHeartbeat } from "./heartbeat";
import { startKanbanWatch } from "./kanban-watch";
import { readProcessStart } from "./process-start";
import {
  readProcessTable,
  reconcileSessions,
  seedRunningSessions,
} from "./reconcile";
import { startListener } from "./server";
import { SessionTracker } from "./tracker";
import { createWriteWatchdog } from "./write-watchdog";
import { SessionWriter } from "./writer";

export interface AgentOptions {
  home: string;
  mongo: { uri: string; db: string };
  /** The Mac's label in the office; defaults to its computer name. */
  computerName?: string;
  now?: () => number;
  flushMs?: number;
  reorderMs?: number;
  /** How often the AI-Kanban folder is re-read, as a backstop for missed file events. */
  kanbanPollMs?: number;
  maxOpsPerSecond?: number;
  /** How often running processes are checked against the registry. */
  reconcileMs?: number;
  /** How often the Mac says it is still here. */
  heartbeatMs?: number;
  /** How long without a successful database write before the agent gives up so the login job restarts it. */
  staleWriteMs?: number;
  /** Called once when the agent has gone stale; the default exits the process. */
  onStale?: () => void;
  log?: (message: string) => void;
}

export interface RunningAgent {
  port: number;
  flush(): Promise<void>;
  /** Checks every tracked session against the registry and the process table now. */
  reconcile(): Promise<void>;
  /** Stamps this Mac's last-seen time now. */
  heartbeat(): Promise<void>;
  /** Gives up (see `onStale`) when no database write has succeeded for too long. */
  checkWriteHealth(): void;
  stop(): Promise<void>;
}

/**
 * Whether the process an `agent.json` names is still that agent: the pid exists and, when a start
 * time was recorded, it is the same process and not a later one that reused the pid.
 * @param previous - The address file a previous agent left.
 * @returns True when the agent may still be running.
 */
function isSameAgentAlive(previous: AgentFile): boolean {
  try {
    process.kill(previous.pid, 0);
  } catch {
    return false;
  }
  if (previous.procStart === undefined) return true;
  const current = readProcessStart(previous.pid);
  // Unreadable start time: assume it is the agent, so two agents never run at once.
  return current === undefined || current === previous.procStart;
}

/**
 * Starts the office agent for one Mac.
 * @param options - Where its home is, which database to write, and the injectable timings.
 * @returns A handle to flush and stop it.
 */
export async function startAgent(options: AgentOptions): Promise<RunningAgent> {
  const { home } = options;
  const previous = readAgentFile(home);
  if (previous && previous.pid !== process.pid && isSameAgentAlive(previous)) {
    throw new Error(
      `Another office agent is already running (pid ${previous.pid}).`,
    );
  }
  // Without the process list the agent would guess which sessions are alive, so it stops before touching the database; the login job retries.
  await readProcessTable().catch((error: unknown) => {
    throw new Error(
      `could not read the process list (ps failed: ${error instanceof Error ? error.message : String(error)})`,
    );
  });
  // Both read once: `~/.claude.json` is large and neither changes while the agent runs.
  const machineId = readMachineId(home);
  const machineName = options.computerName ?? (await readComputerName());

  const client = new MongoClient(options.mongo.uri);
  await client.connect();
  const db = client.db(options.mongo.db);
  await ensureIndexes(db);

  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.error(message));
  const watchdog = createWriteWatchdog({
    now,
    limitMs: options.staleWriteMs ?? 5 * 60_000,
    onStale:
      options.onStale ??
      (() => {
        log(
          "claude-office agent: no database write for 5 minutes; exiting so the login job restarts it",
        );
        process.exit(1);
      }),
  });
  const writer = new SessionWriter(
    db.collection("sessions"),
    db.collection("steps"),
    {
      flushMs: options.flushMs ?? 1000,
      maxOpsPerSecond: options.maxOpsPerSecond ?? 20,
      now,
      log,
      onWriteOk: watchdog.markWrite,
    },
  );
  const tracker = new SessionTracker({
    home,
    machineId,
    machineName,
    reorderMs: options.reorderMs ?? 200,
    now,
    writer,
  });

  const kanban = startKanbanWatch({
    dir: join(home, ".claude", "kanban-session-state"),
    pollMs: options.kanbanPollMs ?? 5000,
    onCard: (sessionId, card) => tracker.setCard(sessionId, card),
  });

  // Read before the first beat overwrites it.
  const previousMachine = await db
    .collection("machines")
    .findOne({ machineId });
  const heartbeat = startHeartbeat({
    machines: db.collection("machines"),
    sessions: db.collection("sessions"),
    machineId,
    machineName,
    intervalMs: options.heartbeatMs ?? 60_000,
    log,
    onWriteOk: watchdog.markWrite,
  });
  await heartbeat.beat();

  // Before the listener opens, so no hook event races the seed.
  await seedRunningSessions({
    home,
    machineId,
    sessions: db.collection("sessions"),
    tracker,
    now,
    lastSeenAt: previousMachine?.lastSeenAt,
  });

  // Checked on its own timer: a wedged connection never reports a failure, so nothing else would notice.
  const staleTimer = setInterval(watchdog.check, 30_000);
  staleTimer.unref();

  const reconcile = () => reconcileSessions(home, tracker);
  const reconcileTimer = setInterval(
    () =>
      // A failed pass (for example `ps` unavailable) is retried at the next tick.
      void reconcile().catch((error: unknown) =>
        log(
          `reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
    options.reconcileMs ?? 5000,
  );
  reconcileTimer.unref();

  const token = randomBytes(24).toString("hex");
  const listener = await startListener(token, (body) => tracker.ingest(body));
  writeAgentFile(home, {
    pid: process.pid,
    port: listener.port,
    token,
    procStart: readProcessStart(process.pid),
  });

  return {
    port: listener.port,
    flush: () => tracker.flush(),
    reconcile,
    heartbeat: heartbeat.beat,
    checkWriteHealth: watchdog.check,
    async stop() {
      rmSync(join(officeDir(home), "agent.json"), { force: true });
      await listener.close();
      kanban.stop();
      clearInterval(reconcileTimer);
      clearInterval(staleTimer);
      heartbeat.stop();
      tracker.stop();
      writer.stop();
      await client.close();
    },
  };
}
