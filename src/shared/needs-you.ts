import { sortByListOrder } from "./list-order";
import type { CompanyCounts } from "./overview";
import type { SessionDto } from "./session";

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

/** The employees of one other company that need the owner. */
export interface NeedsYouGroup {
  companyKey: string;
  companyName: string;
  rows: SessionDto[];
}

/** Everyone who needs the owner, as the Needs you section lists it. */
export interface NeedsYou {
  /** The viewed company's employees, longest wait first. */
  own: SessionDto[];
  /** Other companies in the strip's order, each longest wait first. */
  others: NeedsYouGroup[];
  /** Every listed employee, own and other. */
  total: number;
}

interface NeedsYouInput {
  sessions: Iterable<SessionDto>;
  /** The company of a session; null when its Mac is unknown. */
  companyOf: (
    session: SessionDto,
  ) => { companyKey: string; companyName: string } | null;
  viewedCompany: string | null;
  /** Companies in the strip's order. */
  companyOrder: readonly string[];
  offlineMachineIds: ReadonlySet<string>;
  includeOtherCompanies: boolean;
}

/**
 * Puts the longest wait first, so nobody old is buried under new arrivals.
 * @param rows - One company's needing employees.
 * @returns A new array: oldest `stateSince` first, then rows without one; ties keep the owner's order.
 */
function sortByWait(rows: SessionDto[]): SessionDto[] {
  // A stable sort keeps the owner's order among equal waits
  return sortByListOrder(rows).sort((a, b) => {
    if (a.stateSince === b.stateSince) return 0;
    if (a.stateSince === undefined) return 1;
    if (b.stateSince === undefined) return -1;
    return Date.parse(a.stateSince) - Date.parse(b.stateSince);
  });
}

/**
 * Picks the employees that need the owner, across companies.
 * @param input - The sessions, how they map to companies, and what to leave out.
 * @returns The viewed company's rows, the other companies' groups, the total and the Review items.
 */
export function selectNeedsYou(input: NeedsYouInput): NeedsYou {
  const needing = [...input.sessions].filter(
    (session) =>
      (NEEDS_YOU_STATES as readonly string[]).includes(session.state) &&
      // An offline Mac's states are stale, as the badges treat them
      !input.offlineMachineIds.has(session.machineId),
  );
  const byCompany = new Map<string, SessionDto[]>();
  const names = new Map<string, string>();
  for (const session of needing) {
    const home = input.companyOf(session);
    if (!home) continue;
    names.set(home.companyKey, home.companyName);
    byCompany.set(home.companyKey, [
      ...(byCompany.get(home.companyKey) ?? []),
      session,
    ]);
  }
  const own = sortByWait(byCompany.get(input.viewedCompany ?? "") ?? []);
  // Companies the strip does not list still show, after the listed ones
  const strip = new Map(input.companyOrder.map((key, i) => [key, i]));
  const others = input.includeOtherCompanies
    ? [...byCompany.keys()]
        .filter((key) => key !== input.viewedCompany)
        .sort(
          (a, b) =>
            (strip.get(a) ?? input.companyOrder.length) -
              (strip.get(b) ?? input.companyOrder.length) || (a < b ? -1 : 1),
        )
        .map((key) => ({
          companyKey: key,
          companyName: names.get(key) ?? key,
          rows: sortByWait(byCompany.get(key) ?? []),
        }))
    : [];
  const listed = [...own, ...others.flatMap((group) => group.rows)];
  return {
    own,
    others,
    total: listed.length,
  };
}
