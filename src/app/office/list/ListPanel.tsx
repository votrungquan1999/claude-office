import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { CharacterMugShot } from "@/office/components/CharacterMugShot";
import { employeeName } from "@/shared/employee-name";
import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { RenameEmployeeDialog } from "../RenameEmployeeDialog";
import { ListRow } from "./ListRow";

/** One conversation that went home today. */
export interface DepartureRow {
  /** Session key, which opens its card. */
  key: string;
  palette: number;
  hueShift: number;
  /** The name shown for it. */
  task: string;
  /** `Mac / company/project`. */
  where: string;
  /** Local HH:MM it went home. */
  time: string;
}

interface ListPanelProps {
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
  /** Whether a mouse can drag rows to new places. */
  canDrag: boolean;
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
  companyName,
  employees,
  seenKeys,
  selectedKey,
  reveal,
  departures,
  onSelectDeparture,
  canDrag,
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
  const [wentHomeOpen, setWentHomeOpen] = useState(false);
  // A small move starts a drag, so a plain click still selects the row.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  // The order the rows had when the drag began, so a poll cannot re-sort them under the pointer.
  const [frozen, setFrozen] = useState<SessionDto[] | null>(null);
  const shown = frozen ?? employees;
  // Where the dragged row will land, in the list's own coordinates; null when nothing is dragged.
  const [gap, setGap] = useState<{ top: number; height: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The employee being renamed, picked from a row's pencil; the dialog lives here, outside the rows and the drag.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const renaming = employees.find(
    (session) => sessionKey(session) === renamingKey,
  );
  const place = (id: UniqueIdentifier | undefined) =>
    shown.findIndex((session) => sessionKey(session) === id);
  const nameAt = (id: UniqueIdentifier | undefined) => {
    const session = shown[place(id)];
    return session ? employeeName(session) : "";
  };
  // The status chip's text while a row is dragged; null when nothing is.
  const [chip, setChip] = useState<string | null>(null);
  const announceStart = (id: UniqueIdentifier) =>
    `Moving ${nameAt(id)} to position ${place(id) + 1} of ${shown.length}`;
  const announceMove = (
    verb: string,
    event: Pick<DragOverEvent, "active" | "over">,
  ) =>
    `${verb} ${nameAt(event.active.id)} to position ${place(event.over?.id ?? event.active.id) + 1} of ${shown.length}`;
  // Keyboard dragging is off, so the instructions say only what a mouse can do.
  const accessibility: {
    announcements: Announcements;
    screenReaderInstructions: { draggable: string };
  } = {
    announcements: {
      onDragStart: ({ active }) => announceStart(active.id),
      onDragOver: (event) => announceMove("Moving", event),
      onDragEnd: (event) => announceMove("Moved", event),
      onDragCancel: ({ active }) => `Moving ${nameAt(active.id)} cancelled`,
    },
    screenReaderInstructions: {
      draggable: "Drag with the mouse to move this employee in the list.",
    },
  };
  /** Marks the slot the dragged row would take, from where the row it is over sits. */
  const showGap = (event: DragOverEvent) => {
    const { active, over } = event;
    setChip(announceMove("Moving", event));
    const list = listRef.current;
    const initial = active.rect.current.initial;
    if (!list || !over || !initial) return setGap(null);
    setGap({
      top: over.rect.top - list.getBoundingClientRect().top + list.scrollTop,
      height: initial.height,
    });
  };
  /** Ends the drag and moves the row once, when it was dropped on a row. */
  const drop = (event: DragEndEvent) => {
    setFrozen(null);
    setGap(null);
    setChip(null);
    onDragHover(null);
    const { active, over } = event;
    if (over) onMove(String(active.id), String(over.id));
  };
  return (
    <aside
      aria-label="Employees"
      data-testid="list-panel"
      className="relative flex min-h-0 w-[400px] max-w-[60%] shrink-0 flex-col border-l-2 border-border bg-bg-dark text-sm"
    >
      <div className="flex h-40 shrink-0 items-center border-b-2 border-border px-12">
        <span data-testid="list-title" className="text-xs text-text-muted">
          {companyName} · {employees.length}{" "}
          {employees.length === 1 ? "employee" : "employees"}
        </span>
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
      <section aria-label="Everyone" className="flex min-h-0 flex-1 flex-col">
        <DndContext
          sensors={sensors}
          accessibility={accessibility}
          onDragOver={showGap}
          onDragStart={({ active }) => {
            setFrozen(employees);
            setChip(announceStart(active.id));
            onDragHover(String(active.id));
          }}
          onDragEnd={drop}
          onDragCancel={() => {
            setFrozen(null);
            setGap(null);
            setChip(null);
            onDragHover(null);
          }}
        >
          <SortableContext
            items={shown.map(sessionKey)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              ref={listRef}
              data-testid="list-everyone"
              className="relative min-h-0 flex-1 overflow-y-auto"
            >
              {shown.map((session) => (
                <ListRow
                  key={sessionKey(session)}
                  session={session}
                  draggable={canDrag}
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
              {gap && (
                <li
                  aria-hidden="true"
                  style={{ top: gap.top, height: gap.height }}
                  className="pointer-events-none absolute right-8 left-20 flex items-center justify-center border-2 border-dashed border-accent-bright bg-accent-bright/10 text-xs"
                >
                  Drops here
                </li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
      </section>
      {chip && (
        <span
          role="status"
          data-testid="drag-chip"
          className="pointer-events-none absolute bottom-56 left-18 z-5 border-2 border-accent-bright bg-[#2c2b6d] px-8 py-4 text-xs"
        >
          {chip}
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
      <section
        aria-label="Went home today"
        className="shrink-0 border-t-2 border-border"
      >
        <button
          type="button"
          aria-expanded={wentHomeOpen}
          onClick={() => setWentHomeOpen(!wentHomeOpen)}
          className="flex h-46 w-full items-center gap-8 px-12 text-left text-sm"
        >
          <span aria-hidden="true" className="text-xs">
            {wentHomeOpen ? "▼" : "▶"}
          </span>
          <span className="font-bold">Went home today</span>
          <span className="bg-border px-6 text-xs">{departures.length}</span>
        </button>
        {wentHomeOpen && departures.length === 0 && (
          <p className="px-12 pb-10 text-text-muted">
            Nobody has gone home today
          </p>
        )}
        {wentHomeOpen && (
          <ul
            data-testid="went-home-list"
            className="max-h-[40vh] overflow-y-auto pb-6"
          >
            {departures.map((row) => (
              <li key={row.key} className="border-t border-bg-thumb">
                <button
                  type="button"
                  onClick={() => onSelectDeparture(row.key)}
                  className="flex min-h-48 w-full items-center gap-10 px-12 py-4 text-left hover:bg-btn-hover"
                >
                  <span aria-hidden="true" className="shrink-0 opacity-60">
                    <CharacterMugShot
                      palette={row.palette}
                      hueShift={row.hueShift}
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="truncate text-base">{row.task}</span>
                    <span className="truncate text-xs text-text-muted">
                      {row.where}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    left {row.time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
