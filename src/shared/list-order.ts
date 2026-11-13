import { RANK_MAX_LENGTH, type SessionDto, sessionKey } from "./session";

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

const DIGITS = "abcdefghijklmnopqrstuvwxyz";

/**
 * The middle of two ranks, as fractions written in base 26 ("a" is zero).
 * @param low - The lower rank; empty for the very bottom.
 * @param high - The upper rank, or null for the very top.
 * @returns A rank above `low` and below `high`.
 */
function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    // Ranks share their common start; only what follows it differs.
    let common = 0;
    while ((low[common] ?? "a") === high[common]) common++;
    if (common > 0)
      return (
        high.slice(0, common) + midpoint(low.slice(common), high.slice(common))
      );
  }
  const lowDigit = low ? DIGITS.indexOf(low[0]) : 0;
  const highDigit = high === null ? DIGITS.length : DIGITS.indexOf(high[0]);
  if (highDigit - lowDigit > 1)
    return DIGITS[Math.round((lowDigit + highDigit) / 2)];
  // The first digits are next to each other.
  if (high !== null && high.length > 1) return high.slice(0, 1);
  return DIGITS[lowDigit] + midpoint(low.slice(1), null);
}

/**
 * A rank that sorts strictly between two others.
 * @param low - The rank it must come after; null for none.
 * @param high - The rank it must come before; null for none.
 * @returns A rank of lowercase letters not ending in "a" (so something always fits below it); null when `low` does not come before `high`.
 */
export function rankBetween(
  low: string | null,
  high: string | null,
): string | null {
  if (high !== null && (low ?? "") >= high) return null;
  return midpoint(low ?? "", high);
}

/** One conversation and the place the owner's move gives it. */
export interface RankAssignment {
  machineId: string;
  sessionId: string;
  rank: string;
}

/**
 * The places to save when one row is moved.
 * @param ordered - Every row of the company in the owner's order, also those a filter hides.
 * @param key - The `sessionKey` of the row to move.
 * @param targetIndex - Where the row ends up among the rows that are visible, counted without the moved row itself.
 * @param isVisible - Whether a row is shown; hidden rows keep their order and the moved row lands after its visible neighbour.
 * @returns The moved row and every row that has no place yet, each with its place, so only the moved row changes place; none when the move changes nothing.
 */
export function moveTo<T extends ListOrderRow>(
  ordered: T[],
  key: string,
  targetIndex: number,
  isVisible: (row: T) => boolean = () => true,
): RankAssignment[] {
  const moved = ordered.find((row) => sessionKey(row) === key);
  if (!moved) return [];
  const others = ordered.filter((row) => row !== moved);
  // The moved row goes right after its visible neighbour above, or to the very top.
  const visibleOthers = others.filter(isVisible);
  const above = targetIndex > 0 ? visibleOthers[targetIndex - 1] : undefined;
  const at = above ? others.indexOf(above) + 1 : 0;
  const result = [...others.slice(0, at), moved, ...others.slice(at)];
  if (result.every((row, i) => row === ordered[i])) return [];
  // Rows that already have a place keep it; the others are placed between them, in the new order.
  const mustPlace = (row: T) => row === moved || row.rank === undefined;
  const ranks = new Map<T, string>();
  let start = 0;
  while (start < result.length) {
    if (!mustPlace(result[start])) {
      start++;
      continue;
    }
    let end = start;
    while (end < result.length && mustPlace(result[end])) end++;
    const low = start > 0 ? (result[start - 1].rank ?? null) : null;
    const high = end < result.length ? (result[end].rank ?? null) : null;
    const run = spreadRanks(low, high, end - start);
    // Neighbours with equal ranks leave no room between them, so every row is placed afresh.
    if (!run) return placeAll(result);
    run.forEach((rank, i) => {
      ranks.set(result[start + i], rank);
    });
    start = end;
  }
  // Repeated moves to one end grow the places; past the server's limit the whole company is placed afresh.
  if ([...ranks.values()].some((rank) => rank.length > RANK_MAX_LENGTH))
    return placeAll(result);
  return [...ranks].map(([row, rank]) => ({
    machineId: row.machineId,
    sessionId: row.sessionId,
    rank,
  }));
}

/**
 * Ranks that sort between two others, in order, spread so their length stays short.
 * @param low - The rank before them; null for none.
 * @param high - The rank after them; null for none.
 * @param count - How many ranks are needed.
 * @returns The ranks; null when none fits between `low` and `high`.
 */
function spreadRanks(
  low: string | null,
  high: string | null,
  count: number,
): string[] | null {
  if (count === 0) return [];
  const middle = rankBetween(low, high);
  if (middle === null) return null;
  const half = Math.floor((count - 1) / 2);
  const before = spreadRanks(low, middle, half);
  const after = spreadRanks(middle, high, count - 1 - half);
  return before && after ? [...before, middle, ...after] : null;
}

/**
 * Places every row afresh, evenly, in the given order.
 * @param rows - The rows in their new order.
 * @returns A place for each, all the same length so they sort as numbers do.
 */
function placeAll(rows: ListOrderRow[]): RankAssignment[] {
  // Digits "b" to "z", so no rank ends in "a".
  const base = DIGITS.length - 1;
  let width = 1;
  while (base ** width <= rows.length) width++;
  return rows.map((row, i) => {
    let value = i;
    let rank = "";
    for (let d = 0; d < width; d++) {
      rank = DIGITS[1 + (value % base)] + rank;
      value = Math.floor(value / base);
    }
    return { machineId: row.machineId, sessionId: row.sessionId, rank };
  });
}
