import { describe, expect, it } from "vitest";
import { loadOffice } from "@/test/load-office";
import { getBlockedTiles, getSeatTiles } from "./layout/layoutSerializer";
import { findPath } from "./layout/tileMap";
import { ROOM_ORDER } from "./rooms";

const SEATS_PER_ROOM: Record<string, number> = {
  working: 24,
  needsPermission: 12,
  waitingForYou: 18,
  idle: 18,
};

describe("the office layout", () => {
  it("has the four rooms in screen order, each with its own number of seats and a 34 by 22 map", () => {
    // Given the generated layout with the real furniture loaded
    const office = loadOffice();

    // When we read its rooms and the seats in each
    const labels = (office.getLayout().areas ?? []).map((area) => area.label);
    const seatsByRoom = new Map<string, number>();
    for (const uid of office.seats.keys()) {
      const room = office.seatZone(uid) ?? "none";
      seatsByRoom.set(room, (seatsByRoom.get(room) ?? 0) + 1);
    }

    // Then the four rooms exist, hold their seats, and no seat is left outside a room
    expect(labels).toEqual(ROOM_ORDER);
    expect(labels).toEqual([
      "working",
      "needsPermission",
      "waitingForYou",
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
});
