import { useEffect, useId, useRef, useState } from "react";
import type { SessionState } from "@/shared/session-state";
import {
  ROOM_COLORS,
  ROOM_DISPLAY_NAMES,
  Room,
  STACKED_ROOM_ORDER,
} from "../rooms";
import { CharacterMugShot } from "./CharacterMugShot";

export interface StackedTile {
  /** The session key; also the React key. */
  key: string;
  room: Room;
  task: string;
  palette: number;
  hueShift: number;
  state: SessionState;
  offline: boolean;
  /** When the employee entered its current room, in ms. */
  since: number;
}

interface StackedRoomsProps {
  tiles: StackedTile[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

const REOPENS_ON_ARRIVAL: ReadonlySet<Room> = new Set([
  Room.NeedsPermission,
  Room.WaitingForYou,
]);

const BUBBLE: Partial<Record<SessionState, string>> = {
  needsPermission: "!",
  waitingForYou: "…",
};

/**
 * The tiles of one room, longest in the room first.
 * @param tiles - Every tile.
 * @param room - The room.
 * @returns The room's tiles in order.
 */
function tilesOf(tiles: StackedTile[], room: Room): StackedTile[] {
  return tiles
    .filter((tile) => tile.room === room)
    .sort((a, b) => a.since - b.since || a.key.localeCompare(b.key));
}

/**
 * One room's header: a button that names the room and counts its employees, or plain text when nobody is in it.
 * @param props - The room's name, color, head count, fold state and toggle.
 * @returns The header.
 */
function RoomHeader({
  name,
  color,
  count,
  open,
  controls,
  onToggle,
}: {
  name: string;
  color: string;
  count: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="size-10 shrink-0"
        style={{ background: color }}
      />
      <span className="flex-1 truncate text-left text-sm font-bold">
        {name}
      </span>
      <span className="text-sm opacity-70">{count}</span>
      {count > 0 && (
        <span aria-hidden="true" className="text-xs">
          {open ? "▼" : "▶"}
        </span>
      )}
    </>
  );
  const cls =
    "flex min-h-[44px] items-center gap-8 border-2 border-b-0 border-border bg-bg px-10 text-inherit";
  return count === 0 ? (
    <div className={cls}>{content}</div>
  ) : (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={`${name}, ${count}`}
      onClick={onToggle}
      className={cls}
    >
      {content}
    </button>
  );
}

/**
 * The company's employees in four stacked rooms, for a phone.
 * @param props - The tiles, the selected one and the tap handler.
 * @returns The rooms, scrolling on their own.
 */
export function StackedRooms({
  tiles,
  selectedKey,
  onSelect,
}: StackedRoomsProps) {
  const idBase = useId();
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastSelected = useRef<string | null>(null);
  // The details sheet closing clears the selection; focus goes back to the tile that opened it.
  useEffect(() => {
    if (selectedKey === null && lastSelected.current !== null) {
      tileRefs.current.get(lastSelected.current)?.focus();
    }
    lastSelected.current = selectedKey;
  }, [selectedKey]);
  // Keyed by room so a fold survives tiles coming and going.
  const [folded, setFolded] = useState<ReadonlySet<Room>>(new Set());
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (room: Room) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(room)) next.add(room);
      return next;
    });
  const tileIds = new Set(tiles.map((t) => `${t.room}\0${t.key}`));
  // Adjusted during render so the arrival opens the room in the same paint.
  if (tileIds.size !== seen.size || [...tileIds].some((id) => !seen.has(id))) {
    setSeen(tileIds);
    const arrivals = tiles.filter(
      (t) => !seen.has(`${t.room}\0${t.key}`) && REOPENS_ON_ARRIVAL.has(t.room),
    );
    if (arrivals.some((t) => folded.has(t.room))) {
      const next = new Set(folded);
      for (const t of arrivals) next.delete(t.room);
      setFolded(next);
    }
  }
  return (
    <div
      data-testid="stacked-rooms"
      className="flex h-full min-w-0 flex-col gap-12 overflow-y-auto p-10"
      style={{ touchAction: "pan-y" }}
    >
      {STACKED_ROOM_ORDER.map((room) => {
        const name = ROOM_DISPLAY_NAMES[room];
        const color = ROOM_COLORS[room];
        const inRoom = tilesOf(tiles, room);
        const open = !folded.has(room);
        const gridId = `${idBase}-${room}`;
        return (
          <section key={room} aria-label={name} className="flex flex-col">
            <RoomHeader
              name={name}
              color={color}
              count={inRoom.length}
              open={open}
              controls={gridId}
              onToggle={() => toggle(room)}
            />
            {inRoom.length === 0 ? (
              <p className="border-2 border-border px-10 py-8 text-xs opacity-60">
                Nobody here right now
              </p>
            ) : (
              open && (
                <div
                  id={gridId}
                  className="grid gap-x-6 gap-y-16 border-2 border-border px-6 pt-10 pb-14"
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(104px, 1fr))",
                    background: `color-mix(in srgb, ${color} 40%, var(--color-bg))`,
                  }}
                >
                  {inRoom.map((tile) => (
                    <button
                      key={tile.key}
                      ref={(el) => {
                        if (el) tileRefs.current.set(tile.key, el);
                        else tileRefs.current.delete(tile.key);
                      }}
                      type="button"
                      aria-label={`${tile.task}, ${name}`}
                      aria-current={
                        tile.key === selectedKey ? "true" : undefined
                      }
                      onClick={() => onSelect(tile.key)}
                      className="flex min-h-[44px] min-w-0 flex-col items-center gap-3 border-0 bg-transparent p-0 text-inherit aria-[current=true]:outline-2 aria-[current=true]:outline-offset-2 aria-[current=true]:outline-white"
                      style={{ opacity: tile.offline ? 0.5 : 1 }}
                    >
                      <span className="flex h-16 items-end">
                        {BUBBLE[tile.state] && (
                          <span
                            aria-hidden="true"
                            className="border-2 border-bg bg-white px-5 text-xs font-bold text-bg"
                          >
                            {BUBBLE[tile.state]}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className="h-12 w-60 border-b-[3px]"
                        style={{
                          background: "#c8c8d0",
                          borderColor: "#8a5a2b",
                        }}
                      />
                      <CharacterMugShot
                        palette={tile.palette}
                        hueShift={tile.hueShift}
                      />
                      <span
                        className="w-full min-w-0 bg-bg/90 px-4 py-1 text-center text-xs"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {tile.task}
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
