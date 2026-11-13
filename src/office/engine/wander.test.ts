import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDto } from "@/shared/session";
import { loadOffice } from "@/test/load-office";
import { createSceneSync } from "../sceneSync";
import { Direction } from "../types";

/** A session numbered `n` in the given state. */
const session = (n: number, state: SessionDto["state"]): SessionDto => ({
  machineId: "m1",
  machineName: "Mac",
  sessionId: `s${n}`,
  cwd: "/w",
  state,
  startedAt: "2026-11-08T09:00:00.000Z",
  changedAt: "2026-11-08T10:00:00.000Z",
});

/** Deterministic pseudo-random numbers so a wander that escapes its room fails every run. */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

describe("idle employees wander", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only inside their own room, for as long as they are idle", () => {
    // Given three employees seated in the Idle room
    vi.spyOn(Math, "random").mockImplementation(seededRandom(7));
    const office = loadOffice();
    createSceneSync(office).apply(
      [0, 1, 2].map((n) => session(n, "idle")),
      { firstLoad: true },
    );
    const { cols, areaTiles } = office.getLayout();

    // When 30 simulated minutes pass
    const roomsVisited = new Set<string | null | undefined>();
    let moved = false;
    for (let step = 0; step < 30 * 60 * 10; step++) {
      office.update(0.1);
      for (const ch of office.getCharacters()) {
        roomsVisited.add(areaTiles?.[ch.tileRow * cols + ch.tileCol]);
        if (ch.path.length > 0) moved = true;
      }
    }

    // Then they walked around, and never left the Idle room
    expect(moved).toBe(true);
    expect([...roomsVisited]).toEqual(["idle"]);
  });
});

describe("Waiting for you employees stay where they are put", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the seated ones on their benches and the ninth standing still, for half an hour, and still lets one walk out to work", () => {
    // Given nine employees waiting: eight fill the benches, the ninth stands on the floor
    vi.spyOn(Math, "random").mockImplementation(seededRandom(11));
    const office = loadOffice();
    const sync = createSceneSync(office, { smoothMs: 0 });
    const waiting = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      session(n, "waitingForYou"),
    );
    sync.apply(waiting, { firstLoad: true });
    const tileOf = () =>
      office.getCharacters().map((ch) => `${ch.tileCol},${ch.tileRow}`);
    const placed = tileOf();

    // When half an hour passes
    const visited = new Set<string>();
    for (let step = 0; step < 30 * 60 * 10; step++) {
      office.update(0.1);
      for (const tile of tileOf()) visited.add(tile);
    }

    // Then nobody left the tile they were put on
    expect([...visited].sort()).toEqual([...new Set(placed)].sort());

    // And the ninth has no bench and stands
    const ninth = office.getCharacters()[8];
    expect([ninth.seatId, ninth.standing]).toEqual([null, true]);

    // And when one starts working it walks to the Working room while the others stay
    sync.apply([session(0, "working"), ...waiting.slice(1)]);
    for (let step = 0; step < 600; step++) {
      office.update(0.1);
      sync.tick();
    }
    const moved = office.getCharacters()[0];
    expect(office.seatZone(moved.seatId ?? "")).toBe("working");
    expect(tileOf().slice(1)).toEqual(placed.slice(1));
  });
});

describe("Needs permission employees queue at the counter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the first at the place nearest the counter, holding a paper and facing it, and keeps all ten, standing extras included, still for half an hour", () => {
    // Given ten employees needing permission: seven take the queue places, three stand on the floor
    vi.spyOn(Math, "random").mockImplementation(seededRandom(5));
    const office = loadOffice();
    const sync = createSceneSync(office, { smoothMs: 0 });
    sync.apply(
      Array.from({ length: 10 }, (_, n) => session(n, "needsPermission")),
      { firstLoad: true },
    );
    const characters = office.getCharacters();
    const tileOf = () =>
      office.getCharacters().map((ch) => `${ch.tileCol},${ch.tileRow}`);
    const placed = tileOf();
    const firstSeat = office.seats.get(characters[0].seatId ?? "");

    // When half an hour passes
    const visited = new Set<string>();
    for (let step = 0; step < 30 * 60 * 10; step++) {
      office.update(0.1);
      for (const tile of tileOf()) visited.add(tile);
    }

    // Then the first stands on the first listed place, reading, facing left, and never typing
    const [first, ...others] = office.getCharacters();
    expect([first.pose, first.standing, first.dir]).toEqual([
      "read",
      true,
      Direction.LEFT,
    ]);
    expect(first.seatId).toBe(
      [...office.seats.keys()].find(
        (uid) => office.seatZone(uid) === "needsPermission",
      ),
    );
    expect(firstSeat?.assigned).toBe(true);
    expect(others.slice(0, 6).every((ch) => ch.pose === "read")).toBe(true);

    // And nobody left the tile it was put on
    expect([...visited].sort()).toEqual([...new Set(placed)].sort());
  });
});
