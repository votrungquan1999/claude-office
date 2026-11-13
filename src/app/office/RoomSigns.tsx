"use client";

import { useEffect, useState } from "react";
import type { OfficeState } from "@/office/engine/officeState";
import { overlayProjection } from "@/office/projection";
import { ROOM_DISPLAY_NAMES, type Room } from "@/office/rooms";
import { TILE_SIZE, TileType } from "@/office/types";

interface RoomSignsProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  /** Reads the employees in each room, by room label, every frame. */
  roomCounts: () => Record<string, number>;
}

interface RoomAnchor {
  room: Room;
  /** World position of the sign: the centre of the room's own floor, on the wall row above its first floor row, so the sign stays off the seats. */
  worldX: number;
  worldY: number;
}

/**
 * Where each room's sign hangs, from the tiles the layout labels with that room, leaving out doorway tiles that sit in a neighbouring room's wall row.
 * @param officeState - The scene holding the layout.
 * @returns One anchor per labelled room.
 */
export function roomAnchors(officeState: OfficeState): RoomAnchor[] {
  const layout = officeState.getLayout();
  const wall = (col: number, row: number) =>
    layout.tiles[row * layout.cols + col] === TileType.WALL;
  const bounds = new Map<
    string,
    { minCol: number; maxCol: number; minRow: number }
  >();
  layout.areaTiles?.forEach((label, index) => {
    if (!label) return;
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
    // A doorway tile has walls on both sides, and a sign must not sit on one
    const doorway =
      (wall(col - 1, row) && wall(col + 1, row)) ||
      (wall(col, row - 1) && wall(col, row + 1));
    if (doorway) return;
    const seen = bounds.get(label);
    bounds.set(label, {
      minCol: Math.min(seen?.minCol ?? col, col),
      maxCol: Math.max(seen?.maxCol ?? col, col),
      minRow: Math.min(seen?.minRow ?? row, row),
    });
  });
  return [...bounds.entries()].map(([label, b]) => ({
    room: label as Room,
    worldX: ((b.minCol + b.maxCol + 1) / 2) * TILE_SIZE,
    worldY: (b.minRow - 1) * TILE_SIZE,
  }));
}

/**
 * Where the SIGN-OFF label hangs: at the wall row, just right of the whiteboard. The label sits above that line, so a long room sign on the line never covers it.
 * @param officeState - The scene holding the layout.
 * @returns The label's world position, or null when the layout has no whiteboard.
 */
export function signOffAnchor(
  officeState: OfficeState,
): { worldX: number; worldY: number } | null {
  const whiteboard = officeState
    .getLayout()
    .furniture.find((item) => item.type === "WHITEBOARD");
  if (!whiteboard) return null;
  return {
    // A quarter tile clear of the whiteboard's right edge; the label grows to the right
    worldX: (whiteboard.col + 2.25) * TILE_SIZE,
    // The whiteboard ends on the wall row, which is where room signs hang too
    worldY: (whiteboard.row + 1) * TILE_SIZE,
  };
}

/**
 * How many seats each room has.
 * @param officeState - The scene holding the seats.
 * @returns Seat counts by room label.
 */
function seatsByRoom(officeState: OfficeState): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const uid of officeState.seats.keys()) {
    const room = officeState.seatZone(uid);
    if (room) seats[room] = (seats[room] ?? 0) + 1;
  }
  return seats;
}

/**
 * The sign's text: the room's name, followed by "employees / seats" only when more employees are there than seats.
 * @param room - The room.
 * @param employees - Employees in the room.
 * @param seats - Seats in the room.
 * @returns The text to show.
 */
export function signText(room: Room, employees: number, seats: number): string {
  const name = ROOM_DISPLAY_NAMES[room] ?? room;
  return employees > seats ? `${name} ${employees} / ${seats}` : name;
}

/**
 * DOM signs naming each room, kept over their room as the camera pans and zooms.
 * @param props - The scene and the camera.
 * @returns The signs.
 */
export function RoomSigns({
  officeState,
  containerRef,
  zoom,
  panRef,
  roomCounts,
}: RoomSignsProps) {
  const [, setTick] = useState(0);
  // The layout's seats never change, so they are counted once.
  const [seats] = useState(() => seatsByRoom(officeState));
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setTick((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const counts = roomCounts();
  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  // A full-size sign suits a tile of 1 CSS px per world px; on a phone the tile is smaller and the sign shrinks with it.
  const scale = Math.min(1, zoom / (window.devicePixelRatio || 1));
  const signOff = signOffAnchor(officeState);
  return (
    <>
      {roomAnchors(officeState).map((anchor) => (
        <div
          key={anchor.room}
          data-testid="room-sign"
          data-room={anchor.room}
          className="pixel-panel pointer-events-none absolute -translate-x-1/2 whitespace-nowrap"
          style={{
            left: project.toScreenX(anchor.worldX),
            top: project.toScreenY(anchor.worldY),
            fontSize: 18 * scale,
            lineHeight: 1.33,
            padding: `${2 * scale}px ${8 * scale}px`,
            borderWidth: Math.max(1, 2 * scale),
          }}
        >
          {signText(
            anchor.room,
            counts[anchor.room] ?? 0,
            seats[anchor.room] ?? 0,
          )}
        </div>
      ))}
      {signOff && (
        <div
          data-testid="sign-off-label"
          className="pointer-events-none absolute whitespace-nowrap font-semibold"
          style={{
            left: project.toScreenX(signOff.worldX),
            top: project.toScreenY(signOff.worldY),
            // Its bottom edge ends just above the room signs' line
            transform: `translateY(calc(-100% - ${4 * scale}px))`,
            fontSize: 12 * scale,
            lineHeight: 1.33,
            padding: `${1 * scale}px ${6 * scale}px`,
            background: "#e8e0c8",
            color: "#181828",
            border: `${Math.max(1, 2 * scale)}px solid #0b0b12`,
          }}
        >
          SIGN-OFF
        </div>
      )}
    </>
  );
}
