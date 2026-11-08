/** Writes `public/assets/office-layout.json`: four rooms in a 2+2 grid joined by doorways. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOM_ORDER, Room } from "../src/office/rooms";
import type {
  AreaDefinition,
  ColorValue,
  PlacedFurniture,
} from "../src/office/types";
import { TileType } from "../src/office/types";

/** 34 columns by 22 rows keeps a phone's and a desktop's fit-to-screen zoom at 2 or more. */
const COLS = 34;
/** A void row on top gives the first wall's art room to draw upward. */
const TOP_MARGIN = 1;
/** One wall row plus nine floor rows per room. */
const ROOM_ROWS = 10;
const ROWS = TOP_MARGIN + ROOM_ROWS * 2 + 1;

const WALL_COLOR: ColorValue = { h: 214, s: 30, b: -100, c: -55 };
const FLOOR_SATURATION = { s: 39, b: -25, c: -80 };

const ROOM_STYLE: Record<Room, { hue: number; areaColor: string }> = {
  [Room.Working]: { hue: 209, areaColor: "#3b82f6" },
  [Room.NeedsPermission]: { hue: 15, areaColor: "#ef4444" },
  [Room.WaitingForYou]: { hue: 50, areaColor: "#eab308" },
  [Room.Idle]: { hue: 130, areaColor: "#22c55e" },
};

interface RoomBox {
  room: Room;
  /** First column; neighbouring rooms share one wall column. */
  c0: number;
  width: number;
  top: boolean;
}

/** A 2+2 grid: Working and Needs permission on top, Waiting for you and Idle below. */
const ROOMS: RoomBox[] = [
  { room: Room.Working, c0: 0, width: 23, top: true },
  { room: Room.NeedsPermission, c0: 22, width: 12, top: true },
  { room: Room.WaitingForYou, c0: 0, width: 17, top: false },
  { room: Room.Idle, c0: 16, width: 18, top: false },
];

/** The wall row above a room band: the top rooms' own wall, or the wall shared with the bottom rooms. */
const wallRowOf = (top: boolean): number => TOP_MARGIN + (top ? 0 : ROOM_ROWS);

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/assets/office-layout.json",
);

const tiles: number[] = new Array(COLS * ROWS).fill(TileType.VOID);
const tileColors: Array<ColorValue | null> = new Array(COLS * ROWS).fill(null);
const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
const furniture: PlacedFurniture[] = [];

/**
 * Places a piece of furniture with a stable id.
 * @param type - Catalog id of the piece.
 * @param col - Left tile.
 * @param row - Top tile.
 */
function place(type: string, col: number, row: number): void {
  furniture.push({ uid: `f-${furniture.length}`, type, col, row });
}

/**
 * Colours a tile as floor of a room.
 * @param col - Tile column.
 * @param row - Tile row.
 * @param room - The room the tile belongs to.
 */
function setFloor(col: number, row: number, room: Room): void {
  const at = row * COLS + col;
  tiles[at] = TileType.FLOOR_1;
  tileColors[at] = { h: ROOM_STYLE[room].hue, ...FLOOR_SATURATION };
  areaTiles[at] = room;
}

for (const { room, c0, width, top } of ROOMS) {
  const wallRow = wallRowOf(top);
  for (let r = wallRow; r < wallRow + ROOM_ROWS; r++) {
    for (let c = c0; c < c0 + width; c++) {
      const isWall = r === wallRow || c === c0 || c === c0 + width - 1;
      if (isWall) {
        tiles[r * COLS + c] = TileType.WALL;
        tileColors[r * COLS + c] = WALL_COLOR;
      } else {
        setFloor(c, r, room);
      }
    }
  }
}

// The bottom wall closes the lower rooms
const bottom = (ROWS - 1) * COLS;
for (let c = 0; c < COLS; c++) {
  tiles[bottom + c] = TileType.WALL;
  tileColors[bottom + c] = WALL_COLOR;
}

// Doorways: floor tiles in a shared wall, coloured and labelled as the room they open into
setFloor(22, wallRowOf(true) + 5, Room.NeedsPermission);
setFloor(16, wallRowOf(false) + 5, Room.Idle);
setFloor(5, wallRowOf(false), Room.WaitingForYou);
setFloor(18, wallRowOf(false), Room.Idle);
setFloor(28, wallRowOf(false), Room.Idle);

// Stations of two desks facing each other, three seats at each
for (const { c0, width, top } of ROOMS) {
  const wallRow = wallRowOf(top);
  const stations = Math.floor((width - 2) / 5);
  for (let s = 0; s < stations; s++) {
    const deskCol = c0 + 2 + s * 5;
    place("DESK_FRONT", deskCol, wallRow + 2);
    place("DESK_FRONT", deskCol, wallRow + 7);
    for (let seat = 0; seat < 3; seat++) {
      place("PC_BACK", deskCol + seat, wallRow + 2);
      place("CUSHIONED_CHAIR_BACK", deskCol + seat, wallRow + 4);
      place("PC_BACK", deskCol + seat, wallRow + 7);
      place("CUSHIONED_CHAIR_FRONT", deskCol + seat, wallRow + 6);
    }
  }
  place("PLANT", c0 + 1, wallRow + 8);
  place("PLANT", c0 + width - 2, wallRow + 8);
}

const areas: AreaDefinition[] = ROOM_ORDER.map((room) => ({
  label: room,
  color: ROOM_STYLE[room].areaColor,
}));

writeFileSync(
  out,
  JSON.stringify({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    tileColors,
    furniture,
    areas,
    areaTiles,
  }),
);
