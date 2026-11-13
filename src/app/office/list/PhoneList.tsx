import type { Ref } from "react";
import { type SessionDto, sessionKey } from "@/shared/session";
import { ListRow } from "./ListRow";
import { NeedsYouSection, type NeedsYouSectionProps } from "./NeedsYouSection";
import type { ListFoldState } from "./useListFolds";
import { type DepartureRow, WentHomeSection } from "./WentHomeSection";

interface PhoneListProps {
  /** What is folded in the list. */
  fold: ListFoldState;
  /** What the Needs you section lists, and how its rows open employees. */
  needsYou: Pick<
    NeedsYouSectionProps,
    | "needsYou"
    | "viewedCompanyKey"
    | "onSelect"
    | "onMoveAllToIdle"
    | "moveAllError"
  >;
  /** The viewed company's live employees in the owner's order. */
  employees: SessionDto[];
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  /** Today's departures of the viewed company, newest first. */
  departures: DepartureRow[];
  onSelectDeparture: (key: string) => void;
  /** The Macs that are offline. */
  offlineMachineIds: ReadonlySet<string>;
  /** How each repo tag of the viewed company is written, by tag key. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  onSelect: (key: string) => void;
  onMoveToIdle: (key: string) => void;
  /** Gives the bottom bar's Search button the field to focus. */
  searchRef: Ref<HTMLInputElement>;
}

/**
 * The phone's list: a search field above one scrolling list of Needs you, Everyone and Went home.
 * @param props - The company's employees, the folds and the handlers.
 * @returns The list.
 */
export function PhoneList({
  fold,
  needsYou,
  employees,
  selectedKey,
  departures,
  onSelectDeparture,
  offlineMachineIds,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  searchRef,
}: PhoneListProps) {
  return (
    <div data-testid="phone-list" className="flex h-full min-h-0 flex-col">
      {/* Above the scrolling list, so a long list never carries it away */}
      <div className="shrink-0 px-10 pb-6">
        <input
          ref={searchRef}
          type="search"
          aria-label="Search employees"
          placeholder="Search employees"
          className="h-44 w-full border-2 border-border bg-bg-dark px-10 text-base"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NeedsYouSection
          {...needsYou}
          phone
          selectedKey={selectedKey}
          serverOffsetMs={serverOffsetMs}
          onMoveToIdle={onMoveToIdle}
          open={fold.folds.needsYou}
          onToggle={() => fold.toggle("needsYou")}
        />
        <section aria-label="Everyone">
          <button
            type="button"
            aria-expanded={fold.folds.everyone}
            aria-controls="phone-everyone"
            onClick={() => fold.toggle("everyone")}
            className="flex min-h-44 w-full items-center gap-8 px-12 text-left"
          >
            <span aria-hidden="true" className="text-xs">
              {fold.folds.everyone ? "▼" : "▶"}
            </span>
            <span className="font-bold">Everyone</span>
            <span className="bg-border px-6 text-xs">{employees.length}</span>
          </button>
          <ul id="phone-everyone" hidden={!fold.folds.everyone}>
            {employees.map((session) => (
              <ListRow
                key={sessionKey(session)}
                phone
                session={session}
                draggable={false}
                isNew={false}
                selected={sessionKey(session) === selectedKey}
                revealToken={null}
                offline={offlineMachineIds.has(session.machineId)}
                tagLabels={tagLabels}
                serverOffsetMs={serverOffsetMs}
                onSelect={onSelect}
                onMoveToIdle={onMoveToIdle}
                onRequestRename={() => {}}
              />
            ))}
            {employees.length === 0 && (
              <li className="px-12 pb-10 text-text-muted">Nobody here yet</li>
            )}
          </ul>
        </section>
        <WentHomeSection
          flat
          open={fold.folds.wentHome}
          onToggle={() => fold.toggle("wentHome")}
          departures={departures}
          onSelectDeparture={onSelectDeparture}
        />
      </div>
    </div>
  );
}
