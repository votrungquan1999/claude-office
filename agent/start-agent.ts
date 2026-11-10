import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { ensureIndexes } from "../src/db/indexes";
import type { CommandDocument } from "../src/shared/commands";
import { createCommandPoller, failInterrupted } from "./commands";
import { readComputerName } from "./computer-name";
import {
  type AgentFile,
  officeDir,
  readAgentFile,
  readMachineId,
  writeAgentFile,
} from "./config";
import { type FolderDocument, FolderRecorder, refreshFolders } from "./folders";
import { startHeartbeat } from "./heartbeat";
import { startKanbanWatch } from "./kanban-watch";
import { cleanLaunchFiles, KeptDesks } from "./kept";
import { PasteNamer } from "./paste-namer";
import { readProcessStart } from "./process-start";
import {
  readProcessTable,
  reconcileSessions,
  seedRunningSessions,
} from "./reconcile";
import { listRegistry } from "./registry";
import { createRepoResolver } from "./repo-resolver";
import { startListener } from "./server";
import {
  openInTerminal,
  sweepLaunchFiles,
  type TerminalOpener,
} from "./terminal-launch";
import { SessionTracker } from "./tracker";
import { readTrustMap } from "./trust";
import { createWriteWatchdog } from "./write-watchdog";
import { SessionWriter } from "./writer";

const packageJsonSchema = z.object({ version: z.string() });

/** The version in the repo's package.json, which the agent runs from. */
function readPackageVersion(): string {
  const file = fileURLToPath(new URL("../package.json", import.meta.url));
  return packageJsonSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    .version;
}

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
  /** The owner's Anthropic key; paste-only desks are named by Haiku only when it is set. */
  anthropicApiKey?: string;
  /** Where the Anthropic API lives; tests point it at a local fake. */
  anthropicBaseUrl?: string;
  /** How long to wait before the one retry of a failed name request. */
  anthropicRetryMs?: number;
  /** Opens a script in a Terminal window; tests pass a recording fake. */
  terminalOpener?: TerminalOpener;
  /** How long the Terminal opener may take before the order fails; 30 s when absent. */
  openerTimeoutMs?: number;
  /** The claude binary a hired window runs; found on the agent's PATH when absent. */
  claudePath?: string;
  /** The version the agent reports; read from package.json when absent. */
  agentVersion?: string;
  /** How often the web's orders are looked for. */
  commandPollMs?: number;
  log?: (message: string) => void;
}

export interface RunningAgent {
  port: number;
  flush(): Promise<void>;
  /** Checks every tracked session against the registry and the process table now. */
  reconcile(): Promise<void>;
  /** Stamps this Mac's last-seen time now. */
  heartbeat(): Promise<void>;
  /** Claims and runs this Mac's waiting orders now. */
  pollCommands(): Promise<void>;
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
  const kept = new KeptDesks();
  const tracker = new SessionTracker({
    onKeptMoved: (fromId, toId) => kept.moveKept(fromId, toId),
    home,
    machineId,
    machineName,
    reorderMs: options.reorderMs ?? 200,
    now,
    writer,
    repos: createRepoResolver(),
    pasteNamer: options.anthropicApiKey
      ? new PasteNamer({
          home,
          apiKey: options.anthropicApiKey,
          baseUrl: options.anthropicBaseUrl ?? "https://api.anthropic.com",
          retryMs: options.anthropicRetryMs,
          log,
        })
      : undefined,
    folders: new FolderRecorder({
      folders: db.collection<FolderDocument>("folders"),
      machineId,
      log,
    }),
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
  let trustUnreadable = false;
  /** Reads the trust answers, saying so once per unreadable spell. */
  const readTrust = () => {
    const trust = readTrustMap(home);
    if (!trust && !trustUnreadable) {
      log(
        "claude-office agent: Claude Code's trust file is unreadable; folders show no trust warning",
      );
    }
    trustUnreadable = !trust;
    return trust;
  };
  const heartbeat = startHeartbeat({
    machines: db.collection("machines"),
    sessions: db.collection("sessions"),
    machineId,
    machineName,
    agentVersion: options.agentVersion ?? readPackageVersion(),
    afterBeat: () =>
      refreshFolders(
        db.collection<FolderDocument>("folders"),
        machineId,
        readTrust(),
      ).catch((error: unknown) =>
        log(
          `folder check failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
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

  const reconcile = async () => {
    await reconcileSessions(home, tracker);
    // Claude Code has read the message by the time it registers, so the launch files are no longer needed.
    const registered = new Set(listRegistry(home).map((e) => e.sessionId));
    cleanLaunchFiles(kept, home, registered);
  };
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

  // Orders the previous run claimed are over: no window is opened late.
  const commands = db.collection<CommandDocument>("commands");
  await failInterrupted(commands, machineId);
  sweepLaunchFiles(home);
  const commandPoller = createCommandPoller({
    commands,
    folders: db.collection<FolderDocument>("folders"),
    machineId,
    home,
    tracker,
    kept,
    opener: options.terminalOpener ?? openInTerminal,
    openerTimeoutMs: options.openerTimeoutMs,
    claudePath: options.claudePath,
    now,
    log,
  });
  const commandTimer = setInterval(
    () =>
      void commandPoller
        .poll()
        .catch((error: unknown) =>
          log(
            `order poll failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
    options.commandPollMs ?? 1000,
  );
  commandTimer.unref();

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
    async flush() {
      await tracker.flush();
      await tracker.settleNames();
    },
    reconcile,
    pollCommands: commandPoller.poll,
    heartbeat: heartbeat.beat,
    checkWriteHealth: watchdog.check,
    async stop() {
      rmSync(join(officeDir(home), "agent.json"), { force: true });
      await listener.close();
      kanban.stop();
      clearInterval(reconcileTimer);
      clearInterval(staleTimer);
      clearInterval(commandTimer);
      heartbeat.stop();
      tracker.stop();
      writer.stop();
      await client.close();
    },
  };
}
