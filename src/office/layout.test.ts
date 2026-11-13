import { describe, expect, it } from "vitest";
import { loadOffice } from "@/test/load-office";
import { getCatalogEntry } from "./layout/furnitureCatalog";
import { getBlockedTiles, getSeatTiles } from "./layout/layoutSerializer";
import { findPath } from "./layout/tileMap";
import { ROOM_ORDER } from "./rooms";
import { Direction } from "./types";

const SEATS_PER_ROOM: Record<string, number> = {
  working: 24,
  needsPermission: 12,
  waitingForYou: 12,
  review: 12,
  idle: 12,
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
