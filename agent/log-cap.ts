import { statSync, truncateSync } from "node:fs";

/**
 * Empties the agent's log when it has grown past the cap, so a long-running login job cannot fill the disk.
 * launchd keeps the file open in append mode, so writes simply continue at the new end.
 * @param file - The log file path.
 * @param maxBytes - The size above which the log is emptied.
 * @returns Whether the log was emptied.
 */
export function capLogFile(file: string, maxBytes: number): boolean {
  const info = statSync(file, { throwIfNoEntry: false });
  if (!info || info.size <= maxBytes) return false;
  truncateSync(file, 0);
  return true;
}
