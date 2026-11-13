/** What an ended turn left for the owner: a question, a result to look at, or nothing. */
export type TurnResult = "asks" | "reports" | "nothing";

const STRENGTH: Record<TurnResult, number> = {
  asks: 2,
  reports: 1,
  nothing: 0,
};

/**
 * The result that matters more to the owner.
 * @param a - One result.
 * @param b - Another result.
 * @returns Asks beats reports beats nothing.
 */
export function strongerResult(a: TurnResult, b: TurnResult): TurnResult {
  return STRENGTH[a] >= STRENGTH[b] ? a : b;
}
