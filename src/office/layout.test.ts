import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFurnitureCatalog } from "./core/assets/build";
import { OfficeState } from "./engine/officeState";
import { buildDynamicCatalog } from "./layout/furnitureCatalog";
import { getBlockedTiles, getSeatTiles } from "./layout/layoutSerializer";
import { findPath } from "./layout/tileMap";
import { ROOM_ORDER } from "./rooms";
import type { OfficeLayout } from "./types";

const ASSETS_DIR = path.join(process.cwd(), "public/assets");
const MIN_SEATS_PER_ROOM = 10;

/** The generated office with the real furniture catalog loaded (blank sprites; no PNG decoding in node). */
function loadOffice(): OfficeState {
  const catalog = buildFurnitureCatalog(ASSETS_DIR);
  const sprites = Object.fromEntries(
    catalog.map((entry) => [
      entry.id,
      Array.from({ length: entry.height }, () => Array(entry.width).fill("")),
    ]),
  );
  buildDynamicCatalog({ catalog, sprites });
  const layout: OfficeLayout = JSON.parse(
    readFileSync(path.join(ASSETS_DIR, "office-layout.json"), "utf8"),
  );
  return new OfficeState(layout);
}

describe("the office layout", () => {
  it("has the four rooms, each with at least ten seats the employees can use", () => {
    // Given the generated layout with the real furniture loaded
    const office = loadOffice();

    // When we read its rooms and the seats in each
    const labels = (office.getLayout().areas ?? []).map((area) => area.label);
    const seatsByRoom = new Map<string, number>();
    for (const uid of office.seats.keys()) {
      const room = office.seatZone(uid) ?? "none";
      seatsByRoom.set(room, (seatsByRoom.get(room) ?? 0) + 1);
    }

    // Then the four rooms exist and no seat is left outside a room
    expect(labels).toEqual(ROOM_ORDER);
    for (const room of ROOM_ORDER) {
      expect(seatsByRoom.get(room) ?? 0).toBeGreaterThanOrEqual(
        MIN_SEATS_PER_ROOM,
      );
    }
    expect(seatsByRoom.has("none")).toBe(false);
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
