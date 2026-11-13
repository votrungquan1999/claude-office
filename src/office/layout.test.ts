import { describe, expect, it } from "vitest";
import { loadOffice } from "@/test/load-office";
import { getCatalogEntry } from "./layout/furnitureCatalog";
import { getBlockedTiles, getSeatTiles } from "./layout/layoutSerializer";
import { findPath } from "./layout/tileMap";
import { ROOM_ORDER } from "./rooms";
import { Direction, TileType } from "./types";

const SEATS_PER_ROOM: Record<string, number> = {
  working: 24,
  needsPermission: 7,
  waitingForYou: 8,
  review: 12,
  idle: 6,
};

describe("the office layout", () => {
  it("has the five rooms in screen order, each with its own number of seats and a 34 by 22 map", () => {
    // Given the generated layout with the real furniture loaded
    const office = loadOffice();

    // When we read its rooms and the seats in each
    const labels = (office.getLayout().areas ?? []).map((area) => area.label);
    const seatsByRoom = new Map<string, number>();
    for (const uid of office.seats.keys()) {
      const room = office.seatZone(uid) ?? "none";
      seatsByRoom.set(room, (seatsByRoom.get(room) ?? 0) + 1);
    }

    // Then the five rooms exist, hold their seats, and no seat is left outside a room
    expect(labels).toEqual(ROOM_ORDER);
    expect(labels).toEqual([
      "working",
      "needsPermission",
      "waitingForYou",
      "review",
      "idle",
    ]);
    expect(Object.fromEntries(seatsByRoom)).toEqual(SEATS_PER_ROOM);
    expect(office.getLayout().cols).toBe(34);
    expect(office.getLayout().rows).toBe(22);
    expect(seatsByRoom.has("none")).toBe(false);
  });

  it("leaves each room enough open floor for the employees beyond its seats to stand on", () => {
    // Given the office and its walkable tiles
    const office = loadOffice();
    const { cols, areaTiles } = office.getLayout();

    // When we count the walkable tiles of each room that are not seats
    const floorByRoom = new Map<string, number>();
    for (const { col, row } of office.walkableTiles) {
      const room = areaTiles?.[row * cols + col];
      if (room && office.getSeatAtTile(col, row) === null) {
        floorByRoom.set(room, (floorByRoom.get(room) ?? 0) + 1);
      }
    }

    // Then every room has at least 30 of them
    for (const room of ROOM_ORDER) {
      expect(floorByRoom.get(room) ?? 0).toBeGreaterThanOrEqual(30);
    }
  });

  it("lets an employee walk from any seat to any other, through the doorways", () => {
    // Given the office and a walking map where only seat tiles are entered on purpose
    const office = loadOffice();
    const layout = office.getLayout();
    const blocked = getBlockedTiles(
      layout.furniture,
      getSeatTiles(office.seats),
    );
    const seats = [...office.seats.values()];

    // When we path from the first seat to every other seat
    const [first, ...rest] = seats;
    const unreachable = rest.filter(
      (seat) =>
        findPath(
          first.seatCol,
          first.seatRow,
          seat.seatCol,
          seat.seatRow,
          office.tileMap,
          blocked,
        ).length === 0,
    );

    // Then every seat can be reached
    expect(seats.length).toBeGreaterThan(0);
    expect(unreachable).toEqual([]);
  });
  it("shows every Working seat a computer screen: the screen on the desk in front of the sitter faces the sitter", () => {
    // Given the office and the computers on its desks
    const office = loadOffice();
    const computers = new Map(
      (office.getLayout().furniture ?? [])
        .filter(
          (item) => getCatalogEntry(item.type)?.category === "electronics",
        )
        .map((item) => [`${item.col},${item.row}`, item.type]),
    );
    const orientationAt = (col: number, row: number) => {
      const type = computers.get(`${col},${row}`);
      return type ? getCatalogEntry(type)?.orientation : undefined;
    };

    // When we look at the computer in front of each Working seat
    const workingSeats = [...office.seats.entries()].filter(
      ([uid]) => office.seatZone(uid) === "working",
    );
    const seen = workingSeats.map(([, seat]) =>
      seat.facingDir === Direction.UP
        ? orientationAt(seat.seatCol, seat.seatRow - 2)
        : orientationAt(seat.seatCol, seat.seatRow + 1),
    );

    // Then a sitter facing up has a front-facing computer and a sitter facing down has a back-facing one, as the two sit on opposite sides of a desk
    expect(workingSeats).toHaveLength(24);
    expect(
      workingSeats.map(([, seat], index) => [seat.facingDir, seen[index]]),
    ).toEqual(
      workingSeats.map(([, seat]) => [
        seat.facingDir,
        seat.facingDir === Direction.UP ? "front" : "back",
      ]),
    );
  });
});

describe("the Idle lounge", () => {
  it("has no desks or computers, and its places are three sofa seats, a reader at the bookshelf and two standers by the coffee corner, in that fill order", () => {
    // Given the generated office
    const office = loadOffice();
    const { cols, areaTiles, furniture } = office.getLayout();
    const roomAt = (col: number, row: number) =>
      areaTiles?.[row * cols + col] ?? null;

    // When we read the furniture standing in the Idle room and its places
    const idleFurniture = furniture
      // A wall piece stands on the wall row just above the room's floor
      .filter(
        (item) =>
          roomAt(item.col, item.row) === "idle" ||
          roomAt(item.col, item.row + 1) === "idle",
      )
      .map((item) => item.type);
    const places = [...office.seats.entries()]
      .filter(([uid]) => office.seatZone(uid) === "idle")
      .map(([, seat]) => [seat.pose, seat.standing, seat.facingDir]);

    // Then no desk or computer is in the room, and it has the lounge's pieces
    expect(idleFurniture.filter((type) => /^(DESK_|PC_)/.test(type))).toEqual(
      [],
    );
    expect(idleFurniture).toEqual(
      expect.arrayContaining([
        "SOFA_FRONT",
        "COFFEE_TABLE",
        "COFFEE",
        "SMALL_TABLE_FRONT",
        "BOOKSHELF",
        "PLANT",
      ]),
    );

    // And the places fill sofa, reader, sofa, stander, sofa, stander
    expect(places).toEqual([
      ["sit", false, Direction.DOWN],
      ["read", true, Direction.UP],
      ["sit", false, Direction.DOWN],
      ["stand", true, Direction.UP],
      ["sit", false, Direction.UP],
      ["stand", true, Direction.UP],
    ]);
  });
});

describe("the Idle lounge's placing", () => {
  /** Tiles a piece of furniture covers. */
  const tilesOf = (item: { type: string; col: number; row: number }) => {
    const entry = getCatalogEntry(item.type);
    const w = entry?.footprintW ?? 1;
    const h = entry?.footprintH ?? 1;
    return Array.from({ length: w * h }, (_, n) => ({
      col: item.col + (n % w),
      row: item.row + Math.floor(n / w),
    }));
  };

  it("keeps every employee's sprite below the wall row, puts the mugs on the front row of their tables, and keeps the sofa sitter facing a table clear of it", () => {
    // Given the generated office and the Idle room
    const office = loadOffice();
    const { cols, areaTiles, furniture } = office.getLayout();
    const roomAt = (col: number, row: number) =>
      areaTiles?.[row * cols + col] ?? null;
    const idleTiles = (areaTiles ?? []).flatMap((label, at) =>
      label === "idle" ? [Math.floor(at / cols)] : [],
    );
    // The wall row has only the doorways as room tiles, so the first floor row is the first with a run of them
    const firstFloorRow = Math.min(
      ...idleTiles.filter(
        (row) => idleTiles.filter((r) => r === row).length > 1,
      ),
    );
    const places = [...office.seats.entries()]
      .filter(([uid]) => office.seatZone(uid) === "idle")
      .map(([, seat]) => seat);
    const tables = furniture.filter(
      (item) =>
        getCatalogEntry(item.type)?.isDesk &&
        roomAt(item.col, item.row) === "idle",
    );
    const tableTiles = new Set(
      tables.flatMap((table) =>
        tilesOf(table).map(({ col, row }) => `${col},${row}`),
      ),
    );
    const mugs = furniture.filter(
      (item) => item.type === "COFFEE" && roomAt(item.col, item.row) === "idle",
    );

    // Then no employee's sprite (its own tile and the one above) reaches the wall row
    expect(places.filter((seat) => seat.seatRow - 1 < firstFloorRow)).toEqual(
      [],
    );

    // And every mug lies on the front row of the table under it
    expect(mugs.length).toBeGreaterThan(0);
    expect(
      mugs.map((mug) =>
        tables.some(
          (table) =>
            mug.col >= table.col &&
            mug.col < table.col + 2 &&
            mug.row === table.row + 1,
        ),
      ),
    ).toEqual(mugs.map(() => true));

    // And no sitter's sprite overlaps a table tile
    expect(
      places
        .filter((seat) => seat.pose === "sit")
        .filter(
          (seat) =>
            tableTiles.has(`${seat.seatCol},${seat.seatRow}`) ||
            tableTiles.has(`${seat.seatCol},${seat.seatRow - 1}`),
        ),
    ).toEqual([]);
  });
});

describe("the Waiting for you room", () => {
  it("seats eight on benches in two rows that face up at a clock on the wall, with a door on the north wall beside it", () => {
    // Given the generated office
    const office = loadOffice();
    const { cols, areaTiles, tiles, furniture } = office.getLayout();
    const waitingTiles = (areaTiles ?? []).flatMap((label, at) =>
      label === "waitingForYou"
        ? [{ col: at % cols, row: Math.floor(at / cols) }]
        : [],
    );
    // A doorway in the wall row has one tile of the room, so the first floor row is the first with a run of them
    const firstFloorRow = Math.min(
      ...waitingTiles
        .map((t) => t.row)
        .filter((row) => waitingTiles.filter((t) => t.row === row).length > 1),
    );
    const northWallRow = firstFloorRow - 1;

    // When we read its places and the wall pieces
    const places = [...office.seats.entries()]
      .filter(([uid]) => office.seatZone(uid) === "waitingForYou")
      .map(([, seat]) => seat);
    const benchCols = places.map((seat) => seat.seatCol);
    const benchRows = [...new Set(places.map((seat) => seat.seatRow))];
    const clock = furniture.find((item) => item.type === "CLOCK");
    const door = furniture.find((item) => item.type === "DOOR");

    // Then eight places, every one seated with the typing frame held, facing up, in two rows with a walkway between
    expect(
      places.map((seat) => [seat.pose, seat.standing, seat.facingDir]),
    ).toEqual(Array(8).fill(["sit", false, Direction.UP]));
    expect(benchRows).toHaveLength(2);
    expect(benchRows[1] - benchRows[0]).toBeGreaterThanOrEqual(3);

    // And the clock hangs on the wall above the benches, over one of their columns
    expect(clock).toBeDefined();
    expect(benchCols).toContain(clock?.col);
    expect(clock?.row).toBeLessThan(benchRows[0]);

    // And the door stands on the north wall, on a wall tile, clear of the clock and of every other wall piece
    expect(door).toBeDefined();
    expect(door?.row).toBe(northWallRow - 1);
    expect(tiles[northWallRow * cols + (door?.col ?? 0)]).toBe(TileType.WALL);
    expect(waitingTiles.some((t) => t.col === door?.col)).toBe(true);
    const wallPieces = furniture.filter(
      (item) => item !== door && item.row === door?.row,
    );
    expect(wallPieces.map((item) => item.col)).not.toContain(door?.col);
  });
});

describe("the Needs permission sign-off counter", () => {
  it("has a whiteboard, a counter with a paper and the owner's empty chair, and a single queue line of standing places at the counter's front row that fill from the counter outwards, facing the counter", () => {
    // Given the generated office
    const office = loadOffice();
    const { cols, areaTiles, furniture } = office.getLayout();
    const roomAt = (col: number, row: number) =>
      areaTiles?.[row * cols + col] ?? null;
    const inRoom = furniture.filter(
      (item) =>
        roomAt(item.col, item.row) === "needsPermission" ||
        // A wall piece stands on the wall rows above the room's floor
        roomAt(item.col, item.row + 1) === "needsPermission" ||
        roomAt(item.col, item.row + 2) === "needsPermission",
    );
    const typesIn = inRoom.map((item) => item.type);
    const counter = inRoom.find((item) => item.type === "DESK_FRONT");
    const paper = inRoom.find((item) => item.type === "PAPER");
    const chair = inRoom.find((item) =>
      item.type.startsWith("CUSHIONED_CHAIR"),
    );
    const places = [...office.seats.entries()]
      .filter(([uid]) => office.seatZone(uid) === "needsPermission")
      .map(([, seat]) => seat);
    const blocked = getBlockedTiles(furniture, getSeatTiles(office.seats));

    // Then the room has the whiteboard and the counter's one desk, and no computer
    expect(typesIn).toEqual(expect.arrayContaining(["WHITEBOARD", "PAPER"]));
    expect(typesIn.filter((type) => /^DESK_/.test(type))).toEqual([
      "DESK_FRONT",
    ]);
    expect(typesIn.filter((type) => /^PC_/.test(type))).toEqual([]);

    // And the paper lies on the counter's front row, and the owner's chair stands behind it, is no place and stays blocked
    expect(paper?.col).toBeGreaterThanOrEqual(counter?.col ?? 99);
    expect(paper?.col).toBeLessThan((counter?.col ?? 0) + 3);
    expect(paper?.row).toBe((counter?.row ?? 0) + 1);
    expect(chair?.row).toBeLessThan(counter?.row ?? 0);
    expect(
      places.some((s) => s.seatCol === chair?.col && s.seatRow === chair?.row),
    ).toBe(false);
    expect(blocked.has(`${chair?.col},${chair?.row}`)).toBe(true);

    // And the places stand in one line at the counter's front row, east of it, holding a paper, facing left, nearest the counter first
    expect(
      places.map((seat) => [seat.pose, seat.standing, seat.facingDir]),
    ).toEqual(Array(7).fill(["read", true, Direction.LEFT]));
    expect(new Set(places.map((seat) => seat.seatRow))).toEqual(
      new Set([(counter?.row ?? 0) + 1]),
    );
    const counterEdge = (counter?.col ?? 0) + 3;
    expect(places.every((seat) => seat.seatCol >= counterEdge)).toBe(true);
    const distances = places.map((seat) => seat.seatCol - counterEdge);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});
