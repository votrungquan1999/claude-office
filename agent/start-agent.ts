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
import { startKanbanWatch } from "./kanban-watch";
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
  log?: (message: string) => void;
}

export interface RunningAgent {
  port: number;
  flush(): Promise<void>;
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
  const writer = new SessionWriter(db.collection("sessions"), {
    flushMs: options.flushMs ?? 1000,
    maxOpsPerSecond: options.maxOpsPerSecond ?? 20,
    now,
    log: options.log ?? ((message) => console.error(message)),
  });
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

  const token = randomBytes(24).toString("hex");
  const listener = await startListener(token, (body) => tracker.ingest(body));
  writeAgentFile(home, { pid: process.pid, port: listener.port, token });

  return {
    port: listener.port,
    flush: () => tracker.flush(),
    async stop() {
      rmSync(join(officeDir(home), "agent.json"), { force: true });
      await listener.close();
      kanban.stop();
      tracker.stop();
      writer.stop();
      await client.close();
    },
  };
}
