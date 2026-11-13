import { type SessionDto, sessionKey } from "./session";

/** What the list order needs to know about one conversation. */
export type ListOrderRow = Pick<
  SessionDto,
  "machineId" | "sessionId" | "startedAt" | "rank"
>;

/**
 * Puts conversations in the owner's order.
 * @param rows - The conversations to order.
 * @returns A new array: unranked rows on top, newest first, then ranked rows by rank.
 */
export function sortByListOrder<T extends ListOrderRow>(rows: T[]): T[] {
  return [...rows].sort(compareRows);
}

/**
 * Compares two rows in list order.
 * @param a - One row.
 * @param b - Another row.
 * @returns Below zero when `a` comes first.
 */
function compareRows(a: ListOrderRow, b: ListOrderRow): number {
  if (a.rank === undefined && b.rank === undefined) {
    // ISO dates of one format sort as text
    return compareText(b.startedAt, a.startedAt) || compareKeys(a, b);
  }
  if (a.rank === undefined) return -1;
  if (b.rank === undefined) return 1;
  return compareText(a.rank, b.rank) || compareKeys(a, b);
}

/**
 * Breaks a tie between two rows the same way on every device.
 * @param a - One row.
 * @param b - Another row.
 * @returns Below zero when `a`'s key is smaller.
 */
function compareKeys(a: ListOrderRow, b: ListOrderRow): number {
  return compareText(sessionKey(a), sessionKey(b));
}

/**
 * Compares text by character code, so every device and the server agree; `localeCompare` would differ by locale.
 * @param a - One text.
 * @param b - Another text.
 * @returns Below zero, zero or above zero.
 */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
