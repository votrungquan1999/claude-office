"use client";

import { useEffect, useState } from "react";
import type { OfficeState } from "@/office/engine/officeState";
import { overlayProjection } from "@/office/projection";
import { ROOM_DISPLAY_NAMES, type Room } from "@/office/rooms";
import { TILE_SIZE } from "@/office/types";

interface RoomSignsProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

interface RoomAnchor {
  room: Room;
  /** World position of the sign: the room's horizontal centre, on its top row. */
  worldX: number;
  worldY: number;
}

/**
 * Where each room's sign hangs, from the tiles the layout labels with that room.
 * @param officeState - The scene holding the layout.
 * @returns One anchor per labelled room.
 */
function roomAnchors(officeState: OfficeState): RoomAnchor[] {
  const layout = officeState.getLayout();
  const bounds = new Map<
    string,
    { minCol: number; maxCol: number; minRow: number }
  >();
  layout.areaTiles?.forEach((label, index) => {
    if (!label) return;
    const col = index % layout.cols;
    const row = Math.floor(index / layout.cols);
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
    worldY: b.minRow * TILE_SIZE,
  }));
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
}: RoomSignsProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setTick((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  return (
    <>
      {roomAnchors(officeState).map((anchor) => (
        <div
          key={anchor.room}
          data-testid="room-sign"
          data-room={anchor.room}
          className="pixel-panel pointer-events-none absolute -translate-x-1/2 px-8 py-2 text-xs whitespace-nowrap"
          style={{
            left: project.toScreenX(anchor.worldX),
            top: project.toScreenY(anchor.worldY),
          }}
        >
          {ROOM_DISPLAY_NAMES[anchor.room] ?? anchor.room}
        </div>
      ))}
    </>
  );
}
