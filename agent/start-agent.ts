import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MongoClient } from "mongodb";
import { ensureIndexes } from "../src/db/indexes";
import {
  officeDir,
  readAgentFile,
  readMachineId,
  writeAgentFile,
} from "./config";
import { startHeartbeat } from "./heartbeat";
import { startKanbanWatch } from "./kanban-watch";
import { reconcileSessions, seedRunningSessions } from "./reconcile";
import { startListener } from "./server";
import { SessionTracker } from "./tracker";
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
  log?: (message: string) => void;
}

export interface RunningAgent {
  port: number;
  flush(): Promise<void>;
  /** Checks every tracked session against the registry and the process table now. */
  reconcile(): Promise<void>;
  /** Stamps this Mac's last-seen time now. */
  heartbeat(): Promise<void>;
  stop(): Promise<void>;
}

const run = promisify(execFile);

async function defaultComputerName(): Promise<string> {
  try {
    const { stdout } = await run("scutil", ["--get", "ComputerName"]);
    if (stdout.trim()) return stdout.trim();
  } catch {
    // No scutil off macOS; the short host name is the fallback.
  }
  return hostname().split(".")[0];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the office agent for one Mac.
 * @param options - Where its home is, which database to write, and the injectable timings.
 * @returns A handle to flush and stop it.
 */
export async function startAgent(options: AgentOptions): Promise<RunningAgent> {
  const { home } = options;
  const previous = readAgentFile(home);
  if (previous && previous.pid !== process.pid && isAlive(previous.pid)) {
    throw new Error(
      `Another office agent is already running (pid ${previous.pid}).`,
    );
  }
  // Both read once: `~/.claude.json` is large and neither changes while the agent runs.
  const machineId = readMachineId(home);
  const machineName = options.computerName ?? (await defaultComputerName());

  const client = new MongoClient(options.mongo.uri);
  await client.connect();
  const db = client.db(options.mongo.db);
  await ensureIndexes(db);

  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.error(message));
  const writer = new SessionWriter(
    db.collection("sessions"),
    db.collection("steps"),
    {
      flushMs: options.flushMs ?? 1000,
      maxOpsPerSecond: options.maxOpsPerSecond ?? 20,
      now,
      log,
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

  const heartbeat = startHeartbeat({
    machines: db.collection("machines"),
    machineId,
    machineName,
    intervalMs: options.heartbeatMs ?? 60_000,
    log,
  });
  await heartbeat.beat();

  // Before the listener opens, so no hook event races the seed.
  await seedRunningSessions({
    home,
    machineId,
    sessions: db.collection("sessions"),
    tracker,
    now,
  });

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
  writeAgentFile(home, { pid: process.pid, port: listener.port, token });

  return {
    port: listener.port,
    flush: () => tracker.flush(),
    reconcile,
    heartbeat: heartbeat.beat,
    async stop() {
      rmSync(join(officeDir(home), "agent.json"), { force: true });
      await listener.close();
      kanban.stop();
      clearInterval(reconcileTimer);
      heartbeat.stop();
      tracker.stop();
      writer.stop();
      await client.close();
    },
  };
}
