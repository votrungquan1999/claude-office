import { wentHomeTime } from "@/office/wentHome";
import { employeeName } from "@/shared/employee-name";
import { sessionKey } from "@/shared/session";
import { ListRow } from "./ListRow";
import { MatchWhy } from "./MatchWhy";
import type { PhoneSearchHit, PhoneSearchResult } from "./phoneSearch";

interface PhoneSearchResultsProps {
  result: PhoneSearchResult;
  /** The viewed company's shown name. */
  companyName: string;
  /** Whether the other companies are already searched. */
  allCompanies: boolean;
  onSearchAll: () => void;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  offlineMachineIds: ReadonlySet<string>;
  tagLabels: ReadonlyMap<string, string>;
  serverOffsetMs: number;
  /** Opens a live employee of the viewed company. */
  onSelect: (key: string) => void;
  /** Opens a conversation that went home. */
  onSelectDeparture: (key: string) => void;
  /** Opens an employee of another company, switching to it first. */
  onSelectElsewhere: (key: string, companyKey: string) => void;
  onMoveToIdle: (key: string) => void;
}

/**
 * What a phone search found: a count line, the viewed company's matches in the owner's order, those that went home, and the other companies on request.
 * @param props - The result and the handlers.
 * @returns The results in place of the list's sections.
 */
export function PhoneSearchResults({
  result,
  companyName,
  allCompanies,
  onSearchAll,
  selectedKey,
  offlineMachineIds,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onSelectDeparture,
  onSelectElsewhere,
  onMoveToIdle,
}: PhoneSearchResultsProps) {
  /**
   * One match as a row; it has no grip and says why it matched.
   * @param hit - The match.
   * @param onOpen - Opens the employee.
   * @returns The row.
   */
  const rowOf = (hit: PhoneSearchHit, onOpen: (key: string) => void) => (
    <ListRow
      key={sessionKey(hit.session)}
      phone
      why={hit.match}
      session={hit.session}
      draggable={false}
      isNew={false}
      selected={sessionKey(hit.session) === selectedKey}
      revealToken={null}
      offline={offlineMachineIds.has(hit.session.machineId)}
      tagLabels={tagLabels}
      serverOffsetMs={serverOffsetMs}
      onSelect={onOpen}
      onMoveToIdle={onMoveToIdle}
      onRequestRename={() => {}}
    />
  );
  return (
    <section aria-label="Search results">
      <p role="status" className="px-12 py-8 text-xs text-text-muted">
        {result.total === 0
          ? `No match in ${allCompanies ? "any company" : companyName}`
          : `${result.total} ${result.total === 1 ? "match" : "matches"} · kept in your order`}
      </p>
      <ul>{result.own.map((hit) => rowOf(hit, onSelect))}</ul>
      {result.wentHome.length > 0 && (
        <div data-testid="search-went-home">
          <h3 className="px-12 pt-8 pb-2 text-xs text-text-muted uppercase">
            Went home today
          </h3>
          <ul>
            {result.wentHome.map(({ session, match }) => (
              <li
                key={sessionKey(session)}
                className="border-t border-bg-thumb"
              >
                <button
                  type="button"
                  onClick={() => onSelectDeparture(sessionKey(session))}
                  className="flex min-h-56 w-full items-center gap-10 px-12 py-4 text-left"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base">
                      {employeeName(session)}
                    </span>
                    <MatchWhy match={match} />
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    left {wentHomeTime(session.endedAt ?? "")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.others.length > 0 && (
        <div data-testid="search-others">
          <h3 className="px-12 pt-8 pb-2 text-xs text-text-muted uppercase">
            In other companies
          </h3>
          {result.others.map((group) => (
            <div key={group.companyKey}>
              <h4 className="px-12 pt-4 text-xs font-bold">
                {group.companyName}
              </h4>
              <ul>
                {group.hits.map((hit) =>
                  rowOf(hit, (key) => onSelectElsewhere(key, group.companyKey)),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
      {!allCompanies && (
        <button
          type="button"
          onClick={onSearchAll}
          className="mx-12 my-8 min-h-44 border-2 border-border bg-btn-bg px-12 text-sm font-bold"
        >
          Search all companies
        </button>
      )}
    </section>
  );
}
