import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";
import { employeeName } from "@/shared/employee-name";
import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { RenameEmployeeDialog } from "../RenameEmployeeDialog";
import { DropsHereGap } from "./DropsHereGap";
import { FoldedStrip } from "./FoldedStrip";
import { ListRow } from "./ListRow";
import { NeedsYouSection, type NeedsYouSectionProps } from "./NeedsYouSection";
import type { ListFoldState } from "./useListFolds";
import { useRowDrag } from "./useRowDrag";
import type { DepartureRow } from "./WentHomeSection";
import { WentHomeSection } from "./WentHomeSection";

interface ListPanelProps {
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
  /** The viewed company's shown name. */
  companyName: string;
  /** The company's live employees in the owner's order. */
  employees: SessionDto[];
  /** The conversations this device has opened or already had; null when it cannot remember, so no row is new. */
  seenKeys: ReadonlySet<string> | null;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  /** The employee last picked in the office, with a number that changes on every pick; null when the list made the last pick. */
  reveal: { key: string; token: number } | null;
  /** Today's departures of the viewed company, newest first. */
  departures: DepartureRow[];
  /** Opens a departure's card. */
  onSelectDeparture: (key: string) => void;
  /** Opens the Cmd+K search. */
  onSearch: () => void;
  /** Whether rows drag by their grip after a hold (touch screens) rather than from anywhere on the row (mouse). */
  touch: boolean;
  /** Lights up the employee of the row being dragged; null when the drag ends. */
  onDragHover: (key: string | null) => void;
  /** Why the last move was refused; absent when it was not. */
  moveError: string | null;
  /** Moves a row to the place of the row it was dropped on; the panel calls it once per drop. */
  onMove: (key: string, overKey: string) => void;
  /** The Macs that are offline. */
  offlineMachineIds: ReadonlySet<string>;
  /** How each repo tag of the viewed company is written, by tag key. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  onSelect: (key: string) => void;
  onMoveToIdle: (key: string) => void;
  onRename: (key: string, name: string) => Promise<boolean>;
}

/**
 * The list beside the office: the viewed company's employees in the owner's order.
 * @param props - The company, its employees and the handlers.
 * @returns The panel.
 */
export function ListPanel({
  fold,
  needsYou,
  companyName,
  employees,
  seenKeys,
  selectedKey,
  reveal,
  departures,
  onSelectDeparture,
  onSearch,
  touch,
  moveError,
  onDragHover,
  onMove,
  offlineMachineIds,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  onRename,
}: ListPanelProps) {
  const wentHomeOpen = fold.folds.wentHome;
  const drag = useRowDrag({
    employees,
    touch,
    onDragHover,
    onMove,
  });
  // The employee being renamed, picked from a row's pencil; the dialog lives here, outside the rows and the drag.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const renaming = employees.find(
    (session) => sessionKey(session) === renamingKey,
  );
  if (!fold.listOpen) {
    const total = needsYou.needsYou.total;
    return (
      <FoldedStrip
        total={total}
        inOtherCompanies={needsYou.needsYou.others.reduce(
          (sum, group) => sum + group.rows.length,
          0,
        )}
        onOpen={() => fold.setListOpen(true)}
      />
    );
  }
  return (
    <aside
      aria-label="Employees"
      data-testid="list-panel"
      className="relative flex min-h-0 w-[400px] max-w-[60%] shrink-0 flex-col border-l-2 border-border bg-bg-dark text-sm"
    >
      <div className="flex h-40 shrink-0 items-center border-b-2 border-border px-12">
        <span
          data-testid="list-title"
          className="flex-1 text-xs text-text-muted"
        >
          {companyName} · {employees.length}{" "}
          {employees.length === 1 ? "employee" : "employees"}
        </span>
        <button
          type="button"
          onClick={onSearch}
          className="mr-4 border-2 border-border px-8 py-2 text-xs hover:bg-btn-hover"
        >
          ⌘K Search
        </button>
        <button
          type="button"
          aria-label="Fold the list"
          onClick={() => fold.setListOpen(false)}
          className="px-8 text-base hover:bg-btn-hover"
        >
          »
        </button>
      </div>
      {moveError && (
        <p
          role="alert"
          data-testid="list-move-error"
          className="shrink-0 border-b-2 border-warning px-12 py-6 text-xs font-bold text-warning"
        >
          {moveError}
        </p>
      )}
      <NeedsYouSection
        {...needsYou}
        selectedKey={selectedKey}
        serverOffsetMs={serverOffsetMs}
        onMoveToIdle={onMoveToIdle}
        open={fold.folds.needsYou}
        onToggle={() => fold.toggle("needsYou")}
      />
      <section aria-label="Everyone" className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          aria-expanded={fold.folds.everyone}
          aria-controls="list-everyone"
          onClick={() => fold.toggle("everyone")}
          className="flex h-40 shrink-0 items-center gap-8 px-12 text-left"
        >
          <span aria-hidden="true" className="text-xs">
            {fold.folds.everyone ? "▼" : "▶"}
          </span>
          <span className="font-bold">Everyone</span>
          <span className="bg-border px-6 text-xs">{employees.length}</span>
        </button>
        <DndContext {...drag.dndProps}>
          <SortableContext
            items={drag.shown.map(sessionKey)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              ref={drag.listRef}
              id="list-everyone"
              hidden={!fold.folds.everyone}
              data-testid="list-everyone"
              className="relative min-h-0 flex-1 overflow-y-auto"
            >
              {drag.shown.map((session) => (
                <ListRow
                  key={sessionKey(session)}
                  session={session}
                  draggable
                  touchGrip={touch}
                  isNew={
                    seenKeys !== null && !seenKeys.has(sessionKey(session))
                  }
                  selected={sessionKey(session) === selectedKey}
                  revealToken={
                    reveal?.key === sessionKey(session) ? reveal.token : null
                  }
                  offline={offlineMachineIds.has(session.machineId)}
                  tagLabels={tagLabels}
                  serverOffsetMs={serverOffsetMs}
                  onSelect={onSelect}
                  onMoveToIdle={onMoveToIdle}
                  onRequestRename={setRenamingKey}
                />
              ))}
              {drag.gap && <DropsHereGap {...drag.gap} />}
            </ul>
          </SortableContext>
        </DndContext>
      </section>
      {drag.chip && (
        <span
          role="status"
          data-testid="drag-chip"
          className="pointer-events-none absolute bottom-56 left-18 z-5 border-2 border-accent-bright bg-[#2c2b6d] px-8 py-4 text-xs"
        >
          {drag.chip}
        </span>
      )}
      {renaming && (
        <RenameEmployeeDialog
          ownerName={renaming.ownerName}
          automaticName={employeeName({
            deskName: renaming.deskName,
            cwd: renaming.cwd,
          })}
          onSave={(next) => onRename(sessionKey(renaming), next)}
          onClose={() => setRenamingKey(null)}
        />
      )}
      <WentHomeSection
        open={wentHomeOpen}
        onToggle={() => fold.toggle("wentHome")}
        departures={departures}
        onSelectDeparture={onSelectDeparture}
      />
    </aside>
  );
}
