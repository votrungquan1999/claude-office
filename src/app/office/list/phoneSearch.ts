import {
  type EmployeeMatch,
  fieldsOf,
  matchEmployee,
} from "@/shared/employee-search";
import type { SessionDto } from "@/shared/session";

/** An employee a search found, with why. */
export interface PhoneSearchHit {
  session: SessionDto;
  match: EmployeeMatch;
}

/** The matches of one other company. */
export interface PhoneSearchGroup {
  companyKey: string;
  companyName: string;
  hits: PhoneSearchHit[];
}

/** What a phone search shows. */
export interface PhoneSearchResult {
  /** The viewed company's live employees that match, in the owner's order. */
  own: PhoneSearchHit[];
  /** The viewed company's matches that went home today, newest first as given. */
  wentHome: PhoneSearchHit[];
  /** Other companies' matches; empty until the owner asks for them. */
  others: PhoneSearchGroup[];
  /** Every match listed. */
  total: number;
}

interface PhoneSearchInput {
  query: string;
  /** The viewed company's live employees in the owner's order, whatever the repo filter hides. */
  own: SessionDto[];
  /** The viewed company's employees that went home today. */
  departures: SessionDto[];
  /** The other companies' employees in the order to list them, went-home ones included. */
  others: Array<{
    companyKey: string;
    companyName: string;
    sessions: SessionDto[];
  }>;
  /** Whether the owner asked to search the other companies too. */
  includeOthers: boolean;
}

/**
 * Narrows the phone's list to the employees a query finds, without changing their order.
 * @param input - The query and the employees to search.
 * @returns The matches by group.
 */
export function searchPhoneList(input: PhoneSearchInput): PhoneSearchResult {
  const hitsOf = (sessions: SessionDto[]): PhoneSearchHit[] =>
    sessions.flatMap((session) => {
      const match = matchEmployee(input.query, fieldsOf(session));
      return match ? [{ session, match }] : [];
    });
  const own = hitsOf(input.own);
  const wentHome = hitsOf(input.departures);
  const others = input.includeOthers
    ? input.others
        .map((group) => ({
          companyKey: group.companyKey,
          companyName: group.companyName,
          hits: hitsOf(group.sessions),
        }))
        .filter((group) => group.hits.length > 0)
    : [];
  return {
    own,
    wentHome,
    others,
    total:
      own.length +
      wentHome.length +
      others.reduce((sum, group) => sum + group.hits.length, 0),
  };
}
