import { useState } from "react";
import { sortByListOrder } from "@/shared/list-order";
import type { SessionDto } from "@/shared/session";
import { searchPhoneList } from "./phoneSearch";

/** Everything a phone search reads. */
export interface PhoneSearchPool {
  /** The company being viewed. */
  viewedCompanyKey: string | null;
  /** Its live employees in the owner's order, whatever the repo filter hides. */
  own: SessionDto[];
  /** Its employees that went home today. */
  departures: SessionDto[];
  /** Every session this device knows. */
  sessions: SessionDto[];
  /** The company a session belongs to; null when its Mac is unknown. */
  companyOf: (
    session: SessionDto,
  ) => { companyKey: string; companyName: string } | null;
  /** Companies in the strip's order. */
  companyOrder: readonly string[];
}

/**
 * The phone's search: what was typed and what it finds in the viewed company, and in the others once asked.
 * @param pool - The employees to search.
 * @returns The query, the matches while there is one, and the ways to change them.
 */
export function usePhoneSearch(pool: PhoneSearchPool) {
  const [query, setQuery] = useState("");
  // The company the owner asked "Search all companies" in; another company starts narrow again
  const [allIn, setAllIn] = useState<string | null>(null);
  const searching = query.trim() !== "";
  const allCompanies = allIn === pool.viewedCompanyKey;
  const result = searching
    ? searchPhoneList({
        query,
        own: pool.own,
        departures: pool.departures,
        others: allCompanies ? othersOf(pool) : [],
        includeOthers: allCompanies,
      })
    : null;
  return {
    query,
    setQuery,
    searching,
    result,
    allCompanies,
    searchAll: () => setAllIn(pool.viewedCompanyKey),
    clear: () => setQuery(""),
  };
}

/**
 * The other companies' employees, each company in its own order, the companies in the strip's order.
 * @param pool - The employees to search.
 * @returns One entry per other company.
 */
function othersOf(pool: PhoneSearchPool) {
  const byCompany = new Map<
    string,
    { companyKey: string; companyName: string; sessions: SessionDto[] }
  >();
  for (const session of pool.sessions) {
    const home = pool.companyOf(session);
    if (!home || home.companyKey === pool.viewedCompanyKey) continue;
    const group = byCompany.get(home.companyKey) ?? {
      companyKey: home.companyKey,
      companyName: home.companyName,
      sessions: [],
    };
    group.sessions.push(session);
    byCompany.set(home.companyKey, group);
  }
  const place = (key: string) => {
    const at = pool.companyOrder.indexOf(key);
    return at === -1 ? pool.companyOrder.length : at;
  };
  return [...byCompany.values()]
    .sort((a, b) => place(a.companyKey) - place(b.companyKey))
    .map((group) => ({
      ...group,
      // Live matches in the owner's order, then those that went home, newest first
      sessions: [
        ...sortByListOrder(
          group.sessions.filter((session) => session.state !== "wentHome"),
        ),
        ...group.sessions
          .filter((session) => session.state === "wentHome")
          .sort(
            (a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? ""),
          ),
      ],
    }));
}
