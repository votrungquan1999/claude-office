/** Writes `public/assets/office-layout.json`: five rooms joined by doorways, two on top and three below. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOM_ORDER, Room } from "../src/office/rooms";
import type {
  AreaDefinition,
  ColorValue,
  PlacedFurniture,
  SpotDefinition,
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
  [Room.Review]: { hue: 280, areaColor: "#b06ad9" },
  [Room.Idle]: { hue: 130, areaColor: "#22c55e" },
};

interface RoomBox {
  room: Room;
  /** First column; neighbouring rooms share one wall column. */
  c0: number;
  width: number;
  top: boolean;
}

/** Working and Needs permission on top; Waiting for you, Review and Idle below, 12 columns each. */
const ROOMS: RoomBox[] = [
  { room: Room.Working, c0: 0, width: 23, top: true },
  { room: Room.NeedsPermission, c0: 22, width: 12, top: true },
  { room: Room.WaitingForYou, c0: 0, width: 12, top: false },
  { room: Room.Review, c0: 11, width: 12, top: false },
  { room: Room.Idle, c0: 22, width: 12, top: false },
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
/** Places that rooms give their employees, in the order each room fills. */
const spots: SpotDefinition[] = [];
/** Rooms whose employees keep their places. */
const stayPutRooms: Room[] = [];

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
setFloor(11, wallRowOf(false) + 5, Room.Review);
setFloor(22, wallRowOf(false) + 5, Room.Idle);
setFloor(5, wallRowOf(false), Room.WaitingForYou);
setFloor(16, wallRowOf(false), Room.Review);
setFloor(28, wallRowOf(false), Room.Idle);

/**
 * Two desks facing each other per station, three seats at each, and a plant in each lower corner.
 * @param box - The room to furnish.
 */
function furnishWithDesks({ c0, width, top }: RoomBox): void {
  const wallRow = wallRowOf(top);
  const stations = Math.floor((width - 2) / 5);
  for (let s = 0; s < stations; s++) {
    const deskCol = c0 + 2 + s * 5;
    place("DESK_FRONT", deskCol, wallRow + 2);
    place("DESK_FRONT", deskCol, wallRow + 7);
    for (let seat = 0; seat < 3; seat++) {
      // The upper sitter faces up at the desk, so its screen shows its front.
      place("PC_FRONT_OFF", deskCol + seat, wallRow + 2);
      place("CUSHIONED_CHAIR_BACK", deskCol + seat, wallRow + 4);
      place("PC_BACK", deskCol + seat, wallRow + 7);
      place("CUSHIONED_CHAIR_FRONT", deskCol + seat, wallRow + 6);
    }
  }
  place("PLANT", c0 + 1, wallRow + 8);
  place("PLANT", c0 + width - 2, wallRow + 8);
}

/**
 * The lounge: two sofas facing a third across a coffee table, a coffee corner, bookshelves on the wall and a reader standing below them.
 * @param box - The room to furnish.
 */
function furnishAsLounge({ c0, width, top }: RoomBox): void {
  const wallRow = wallRowOf(top);
  const left = c0 + 2;
  const right = c0 + width - 4;
  // Wall: two bookshelves either side of the doorway under the sign
  place("BOOKSHELF", left, wallRow);
  place("BOOKSHELF", right, wallRow);
  // Sofas along the top of the seating area, the coffee table below them and a sofa facing it from below
  place("SOFA_FRONT", left, wallRow + 4);
  place("SOFA_FRONT", left + 3, wallRow + 4);
  place("COFFEE_TABLE", left + 1, wallRow + 5);
  // Mugs lie on the table's front row, or they would float above it
  place("COFFEE", left + 1, wallRow + 6);
  place("COFFEE", left + 2, wallRow + 6);
  // The sofa below leaves a row between it and the table so its sitter is not drawn over the table
  place("SOFA_BACK", left + 1, wallRow + 8);
  // Coffee corner: a small table with a mug on its front row
  place("SMALL_TABLE_FRONT", right, wallRow + 5);
  place("COFFEE", right + 1, wallRow + 6);
  place("PLANT", c0 + 1, wallRow + 8);
  place("PLANT", c0 + width - 2, wallRow + 8);
  // Places in fill order: a sofa, the reader at the bookshelf, a sofa, a stander at the coffee corner, the facing sofa, a second stander
  spots.push(
    { col: left, row: wallRow + 4, facing: "down", pose: "sit" },
    { col: left, row: wallRow + 2, facing: "up", pose: "read", standing: true },
    { col: left + 3, row: wallRow + 4, facing: "down", pose: "sit" },
    { col: right, row: wallRow + 7, facing: "up", pose: "stand" },
    { col: left + 1, row: wallRow + 8, facing: "up", pose: "sit" },
    { col: right + 1, row: wallRow + 7, facing: "up", pose: "stand" },
  );
}

/**
 * The waiting area: two rows of four benches facing a clock, a door on the north wall beside it and a plant.
 * @param box - The room to furnish.
 */
function furnishAsWaitingArea({ c0, width, top }: RoomBox): void {
  const wallRow = wallRowOf(top);
  const benchCol = c0 + 3;
  // The clock is a wall piece two tiles tall, so it starts one row above the wall row
  place("CLOCK", benchCol, wallRow - 1);
  // The door hangs on the north wall like the clock, clear of the doorway at column 5
  place("DOOR", c0 + 8, wallRow - 1);
  place("PLANT", c0 + width - 2, wallRow + 8);
  // The first bench row sits low enough that the room sign and a sitter's bubble stay apart
  for (const row of [wallRow + 4, wallRow + 7]) {
    for (let col = benchCol; col < benchCol + 4; col++) {
      place("CUSHIONED_BENCH", col, row);
      spots.push({ col, row, facing: "up", pose: "sit" });
    }
  }
  stayPutRooms.push(Room.WaitingForYou);
}

/** How each room is furnished; one entry per room. */
const FURNISH: Record<Room, (box: RoomBox) => void> = {
  [Room.Working]: furnishWithDesks,
  [Room.NeedsPermission]: furnishWithDesks,
  [Room.WaitingForYou]: furnishAsWaitingArea,
  [Room.Review]: furnishWithDesks,
  [Room.Idle]: furnishAsLounge,
};
for (const box of ROOMS) FURNISH[box.room](box);

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
    ...(spots.length ? { spots } : {}),
    ...(stayPutRooms.length ? { stayPutRooms } : {}),
  }),
);
