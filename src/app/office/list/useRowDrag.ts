import {
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRef, useState } from "react";
import { employeeName } from "@/shared/employee-name";
import { type SessionDto, sessionKey } from "@/shared/session";

interface RowDragInput {
  /** The company's employees in the owner's order. */
  employees: SessionDto[];
  /** Whether rows drag by a grip after a hold (touch screens) instead of from anywhere on the row after a small move (mouse). */
  touch: boolean;
  /** Lights up the employee of the row being dragged; null when the drag ends. */
  onDragHover: (key: string | null) => void;
  /** Moves a row to the place of the row it was dropped on. */
  onMove: (key: string, overKey: string) => void;
}

/**
 * Dragging rows in Everyone: freezes the order, marks where the row lands, and announces the move.
 * @param input - The employees, how they drag and what to tell when a drag starts, ends or drops.
 * @returns The rows as they show, the DndContext props, the drop gap, the status chip text and the ref of the list.
 */
export function useRowDrag({
  employees,
  touch,
  onDragHover,
  onMove,
}: RowDragInput) {
  // A hold on the grip starts a touch drag so a brush never lifts a row; a small move starts a mouse drag so a click still selects.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: touch
        ? { delay: 250, tolerance: 8 }
        : { distance: 8 },
    }),
  );
  // The order the rows had when the drag began, so a poll cannot re-sort them under the pointer.
  const [frozen, setFrozen] = useState<SessionDto[] | null>(null);
  const shown = frozen ?? employees;
  // Where the dragged row will land, in the list's own coordinates; null when nothing is dragged.
  const [gap, setGap] = useState<{ top: number; height: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The status chip's text while a row is dragged; null when nothing is.
  const [chip, setChip] = useState<string | null>(null);
  const place = (id: UniqueIdentifier | undefined) =>
    shown.findIndex((session) => sessionKey(session) === id);
  const nameAt = (id: UniqueIdentifier | undefined) => {
    const session = shown[place(id)];
    return session ? employeeName(session) : "";
  };
  const announceStart = (id: UniqueIdentifier) =>
    `Moving ${nameAt(id)} to position ${place(id) + 1} of ${shown.length}`;
  const announceMove = (
    verb: string,
    event: Pick<DragOverEvent, "active" | "over">,
  ) =>
    `${verb} ${nameAt(event.active.id)} to position ${place(event.over?.id ?? event.active.id) + 1} of ${shown.length}`;
  // Keyboard dragging is off, so the instructions say only what the pointer can do.
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
      draggable: touch
        ? "Hold this grip and drag to move this employee in the list."
        : "Drag with the mouse to move this employee in the list.",
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
  const end = () => {
    setFrozen(null);
    setGap(null);
    setChip(null);
    onDragHover(null);
  };
  /** Ends the drag and moves the row once, when it was dropped on a row. */
  const drop = (event: DragEndEvent) => {
    end();
    const { active, over } = event;
    if (over) onMove(String(active.id), String(over.id));
  };
  return {
    shown,
    gap,
    chip,
    listRef,
    dndProps: {
      sensors,
      accessibility,
      onDragOver: showGap,
      onDragStart: ({ active }: { active: { id: UniqueIdentifier } }) => {
        setFrozen(employees);
        setChip(announceStart(active.id));
        onDragHover(String(active.id));
      },
      onDragEnd: drop,
      onDragCancel: end,
    },
  };
}
