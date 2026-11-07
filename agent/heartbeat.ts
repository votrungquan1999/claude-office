import type { Collection } from "mongodb";

export interface HeartbeatOptions {
  machines: Collection;
  machineId: string;
  machineName: string;
  intervalMs: number;
  log: (message: string) => void;
}

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
  const { machines, machineId, machineName, intervalMs, log } = options;
  const beat = async () => {
    try {
      // The database stamps the time, so a Mac with a wrong clock cannot look offline or alive by mistake.
      await machines.updateOne(
        { machineId },
        { $set: { machineName }, $currentDate: { lastSeenAt: true } },
        { upsert: true },
      );
    } catch (error) {
      // The next beat tries again; one missed beat is well inside the offline window.
      log(
        `heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();
  return { beat, stop: () => clearInterval(timer) };
}
