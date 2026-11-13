import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Ref } from "react";
import { type SessionDto, sessionKey } from "@/shared/session";
import { DropsHereGap } from "./DropsHereGap";
import { ListRow } from "./ListRow";
import { NeedsYouSection, type NeedsYouSectionProps } from "./NeedsYouSection";
import { PhoneSearchResults } from "./PhoneSearchResults";
import type { ListFoldState } from "./useListFolds";
import { type PhoneSearchPool, usePhoneSearch } from "./usePhoneSearch";
import { useRowDrag } from "./useRowDrag";
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
  /** The conversations this device has opened or already had at its first answer; null while unknown. */
  seenKeys: ReadonlySet<string> | null;
  /** The Macs that are offline. */
  offlineMachineIds: ReadonlySet<string>;
  /** How each repo tag of the viewed company is written, by tag key. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  onSelect: (key: string) => void;
  onMoveToIdle: (key: string) => void;
  /** Lights up the employee of the row being dragged; null when the drag ends. */
  onDragHover: (key: string | null) => void;
  /** Moves a row to the place of the row it was dropped on; called once per drop. */
  onMove: (key: string, overKey: string) => void;
  /** Why the last move was refused; null when it was not. */
  moveError: string | null;
  /** Gives the bottom bar's Search button the field to focus. */
  searchRef: Ref<HTMLInputElement>;
  /** The viewed company's shown name. */
  companyName: string;
  /** What a search reads. */
  search: PhoneSearchPool;
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
  seenKeys,
  offlineMachineIds,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  onDragHover,
  onMove,
  moveError,
  searchRef,
  companyName,
  search: pool,
}: PhoneListProps) {
  const search = usePhoneSearch(pool);
  // Only the grip drags, after a hold, so a swipe anywhere else scrolls the list.
  const drag = useRowDrag({ employees, touch: true, onDragHover, onMove });
  return (
    <div
      data-testid="phone-list"
      className="relative flex h-full min-h-0 flex-col"
    >
      {/* Above the scrolling list, so a long list never carries it away */}
      <div className="relative shrink-0 px-10 pb-6">
        <input
          ref={searchRef}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          type="search"
          aria-label="Search employees"
          placeholder="Search employees"
          className="h-44 w-full border-2 border-border bg-bg-dark pr-44 pl-10 text-base"
        />
        {search.searching && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={search.clear}
            className="absolute top-0 right-10 size-44 text-base"
          >
            ✕
          </button>
        )}
      </div>
      {moveError && (
        <p
          role="alert"
          className="shrink-0 border-y-2 border-warning px-12 py-6 text-xs font-bold text-warning"
        >
          {moveError}
        </p>
      )}
      <div
        data-testid="phone-list-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {search.result ? (
          <PhoneSearchResults
            result={search.result}
            companyName={companyName}
            allCompanies={search.allCompanies}
            onSearchAll={search.searchAll}
            selectedKey={selectedKey}
            offlineMachineIds={offlineMachineIds}
            tagLabels={tagLabels}
            serverOffsetMs={serverOffsetMs}
            onSelect={onSelect}
            onSelectDeparture={onSelectDeparture}
            onSelectElsewhere={needsYou.onSelect}
            onMoveToIdle={onMoveToIdle}
          />
        ) : (
          <>
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
                <span className="bg-border px-6 text-xs">
                  {employees.length}
                </span>
              </button>
              <DndContext {...drag.dndProps}>
                <SortableContext
                  items={drag.shown.map(sessionKey)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul
                    ref={drag.listRef}
                    id="phone-everyone"
                    hidden={!fold.folds.everyone}
                    className="relative"
                  >
                    {drag.shown.map((session) => (
                      <ListRow
                        key={sessionKey(session)}
                        phone
                        draggable
                        touchGrip
                        session={session}
                        isNew={
                          seenKeys !== null &&
                          !seenKeys.has(sessionKey(session))
                        }
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
                      <li className="px-12 pb-10 text-text-muted">
                        Nobody here yet
                      </li>
                    )}
                    {drag.gap && <DropsHereGap {...drag.gap} />}
                  </ul>
                </SortableContext>
              </DndContext>
            </section>
            <WentHomeSection
              flat
              open={fold.folds.wentHome}
              onToggle={() => fold.toggle("wentHome")}
              departures={departures}
              onSelectDeparture={onSelectDeparture}
            />
          </>
        )}
      </div>
      {drag.chip && (
        <span
          role="status"
          data-testid="drag-chip"
          className="pointer-events-none absolute inset-x-10 bottom-12 z-5 border-2 border-accent-bright bg-[#2c2b6d] px-8 py-6 text-sm"
        >
          {drag.chip}
        </span>
      )}
    </div>
  );
}
