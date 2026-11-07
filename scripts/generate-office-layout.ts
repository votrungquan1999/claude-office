/** Writes `public/assets/office-layout.json`: four stacked rooms joined by doorways. */
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

/** Narrow enough that a phone's fit-to-screen zoom is at least 2. */
const COLS = 24;
/** One wall row plus six floor rows per room. */
const ROOM_ROWS = 7;
/** A void row on top gives the first wall's art room to draw upward. */
const TOP_MARGIN = 1;
const ROWS = TOP_MARGIN + ROOM_ROWS * ROOM_ORDER.length + 1;
/** Desks start at these columns; each is 3 wide with one chair per column below it. */
const DESK_COLS = [2, 7, 12, 17];
const DOORWAY_COLS = [11, 12];

const WALL_COLOR: ColorValue = { h: 214, s: 30, b: -100, c: -55 };
const FLOOR_SATURATION = { s: 39, b: -25, c: -80 };

const ROOM_STYLE: Record<Room, { hue: number; areaColor: string }> = {
  [Room.Working]: { hue: 209, areaColor: "#3b82f6" },
  [Room.Thinking]: { hue: 280, areaColor: "#a855f7" },
  [Room.NeedsPermission]: { hue: 15, areaColor: "#ef4444" },
  [Room.Waiting]: { hue: 130, areaColor: "#22c55e" },
};

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

ROOM_ORDER.forEach((room, index) => {
  const wallRow = TOP_MARGIN + index * ROOM_ROWS;
  const floorColor: ColorValue = {
    h: ROOM_STYLE[room].hue,
    ...FLOOR_SATURATION,
  };
  for (let r = wallRow; r < wallRow + ROOM_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const at = r * COLS + c;
      const isWall = r === wallRow || c === 0 || c === COLS - 1;
      // A doorway is a floor tile in the shared wall row (not the very top wall).
      const isDoorway = r === wallRow && index > 0 && DOORWAY_COLS.includes(c);
      if (isWall && !isDoorway) {
        tiles[at] = TileType.WALL;
        tileColors[at] = WALL_COLOR;
        continue;
      }
      tiles[at] = TileType.FLOOR_1;
      tileColors[at] = floorColor;
      areaTiles[at] = room;
    }
  }

  // Four desk stations: a desk with a PC and a chair for each of its three places
  for (const deskCol of DESK_COLS) {
    place("DESK_FRONT", deskCol, wallRow + 2);
    for (let seat = 0; seat < 3; seat++) {
      place("PC_BACK", deskCol + seat, wallRow + 2);
      place("CUSHIONED_CHAIR_BACK", deskCol + seat, wallRow + 4);
    }
  }
  place("PLANT", 1, wallRow + 5);
  place("PLANT", COLS - 2, wallRow + 5);
});

// The bottom wall closes the last room
const bottom = (ROWS - 1) * COLS;
for (let c = 0; c < COLS; c++) {
  tiles[bottom + c] = TileType.WALL;
  tileColors[bottom + c] = WALL_COLOR;
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
