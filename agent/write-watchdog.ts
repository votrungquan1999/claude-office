export interface WriteWatchdogOptions {
  now: () => number;
  /** How long without a successful write counts as stale. */
  limitMs: number;
  onStale: () => void;
  /** A longer pause between two checks means the machine was suspended, not that writes failed. Defaults to two minutes. */
  sleepGapMs?: number;
}

export interface WriteWatchdog {
  /** Records a successful database write. */
  markWrite(): void;
  /** Calls `onStale` once when the last write is older than the limit. */
  check(): void;
}

/**
 * Notices when the agent can no longer write, for example after the Mac slept with a dead
 * connection. KeepAlive only restarts a process that exits, so a hung agent has to end itself.
 * @param options - The clock, the limit and what to do when stale.
 * @returns Handles to record writes and to check.
 */
export function createWriteWatchdog(
  options: WriteWatchdogOptions,
): WriteWatchdog {
  const sleepGapMs = options.sleepGapMs ?? 2 * 60_000;
  let lastWriteAt = options.now();
  let lastCheckAt = lastWriteAt;
  let fired = false;
  return {
    markWrite() {
      lastWriteAt = options.now();
    },
    check() {
      const at = options.now();
      const slept = at - lastCheckAt > sleepGapMs;
      lastCheckAt = at;
      // The sleep gives the connection a fresh limit to recover in after waking.
      if (slept) lastWriteAt = at;
      if (fired || options.now() - lastWriteAt < options.limitMs) return;
      fired = true;
      options.onStale();
    },
  };
}
