import type { SessionState } from "@/shared/session-state";
import {
  ROOM_COLORS,
  ROOM_DISPLAY_NAMES,
  type Room,
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
 * @param props - The room's name, color and head count.
 * @returns The header.
 */
function RoomHeader({
  name,
  color,
  count,
}: {
  name: string;
  color: string;
  count: number;
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
    </>
  );
  const cls =
    "flex min-h-[44px] items-center gap-8 border-2 border-b-0 border-border bg-bg px-10 text-inherit";
  return count === 0 ? (
    <div className={cls}>{content}</div>
  ) : (
    <button
      type="button"
      aria-expanded="true"
      aria-label={`${name}, ${count}`}
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
        return (
          <section key={room} aria-label={name} className="flex flex-col">
            <RoomHeader name={name} color={color} count={inRoom.length} />
            {inRoom.length === 0 ? (
              <p className="border-2 border-border px-10 py-8 text-xs opacity-60">
                Nobody here right now
              </p>
            ) : (
              <div
                className="grid gap-x-6 gap-y-16 border-2 border-border px-6 pt-10 pb-14"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
                  background: `color-mix(in srgb, ${color} 40%, var(--color-bg))`,
                }}
              >
                {inRoom.map((tile) => (
                  <button
                    key={tile.key}
                    type="button"
                    aria-label={`${tile.task}, ${name}`}
                    aria-pressed={tile.key === selectedKey}
                    onClick={() => onSelect(tile.key)}
                    className="flex min-h-[44px] min-w-0 flex-col items-center gap-3 border-0 bg-transparent p-0 text-inherit"
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
                      style={{ background: "#c8c8d0", borderColor: "#8a5a2b" }}
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
            )}
          </section>
        );
      })}
    </div>
  );
}
