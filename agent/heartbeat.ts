import type { Collection } from "mongodb";
import type { AgentCodeReport } from "./agent-code";

export interface HeartbeatOptions {
  machines: Collection;
  /** The sessions collection; open sessions of this Mac are kept alive while it beats. */
  sessions: Collection;
  machineId: string;
  machineName: string;
  /** Reported with every beat so the office can tell an agent that cannot take orders. */
  agentVersion: string;
  intervalMs: number;
  log: (message: string) => void;
  /** Called after a beat that landed. */
  onWriteOk?: () => void;
  /** What code the agent runs, re-read before every beat. */
  code?: () => Promise<AgentCodeReport>;
  /** Runs after every beat's own writes; owns its error handling. */
  afterBeat?: () => Promise<void>;
}

const SESSION_RENEW_AFTER_MS = 86_400_000;

export interface Heartbeat {
  /** Stamps the Mac's last-seen time now. */
  beat(): Promise<void>;
  stop(): void;
}

/**
 * Tells the office this Mac is still running, once at start and then every interval.
 * @param options - Where to write and how often.
 * @returns A handle to beat on demand and to stop.
 */
export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
  const {
    machines,
    sessions,
    machineId,
    machineName,
    agentVersion,
    intervalMs,
    log,
  } = options;
  // The start time is stamped by the first beat that lands, so the page sees a new agent by a new time.
  let startRecorded = false;
  const beat = async () => {
    try {
      const code = await options.code?.();
      // The database stamps the time, so a Mac with a wrong clock cannot look offline or alive by mistake.
      await machines.updateOne(
        { machineId },
        {
          $set: {
            machineName,
            agentVersion,
            ...(code ? { restartNeeded: code.restartNeeded } : {}),
            ...(code?.agentCommit ? { agentCommit: code.agentCommit } : {}),
          },
          // A commit left by an earlier agent must not be shown for this one.
          ...(code && !code.agentCommit ? { $unset: { agentCommit: "" } } : {}),
          $currentDate: startRecorded
            ? { lastSeenAt: true }
            : { lastSeenAt: true, agentStartedAt: true },
        },
        { upsert: true },
      );
      startRecorded = true;
      // An idle open session is never rewritten, so its last-seen time is renewed here, at most once a day.
      await sessions.updateMany(
        {
          machineId,
          endedAt: { $exists: false },
          lastSeenAt: { $lt: new Date(Date.now() - SESSION_RENEW_AFTER_MS) },
        },
        { $currentDate: { lastSeenAt: true } },
      );
      options.onWriteOk?.();
    } catch (error) {
      // The next beat tries again; one missed beat is well inside the offline window.
      log(
        `heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await options.afterBeat?.();
  };
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();
  return { beat, stop: () => clearInterval(timer) };
}
