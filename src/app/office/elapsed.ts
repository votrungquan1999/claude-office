/**
 * A time spent in one state, in short form.
 * @param rawMs - The elapsed time in milliseconds; below zero reads as zero.
 * @returns "45s", "3m 12s", "1h 05m" or "2d 3h".
 */
export function formatElapsed(rawMs: number): string {
  const seconds = Math.floor(Math.max(0, rawMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
