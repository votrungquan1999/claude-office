import type { CompanyCounts } from "./overview";

/** The states that ask something of the owner. */
export const NEEDS_YOU_STATES = [
  "needsPermission",
  "waitingForYou",
  "review",
] as const;

/**
 * Counts the employees that need the owner.
 * @param counts - A company's counts by room.
 * @returns Needs permission, Waiting for you and Review added up.
 */
export function needsYouCount(counts: CompanyCounts): number {
  return NEEDS_YOU_STATES.reduce((sum, state) => sum + counts[state], 0);
}
