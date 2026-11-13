import { describe, expect, it } from "vitest";
import { loadOffice } from "@/test/load-office";
import { getCharacterSprite } from "./engine/characters";
import { createSceneSync } from "./sceneSync";
import type { CharacterSprites } from "./sprites/spriteData";
import { Direction, type OfficeLayout, TileType } from "./types";

const COLS = 12;
const ROWS = 6;

/** Three rooms side by side: idle (cols 0-3), working (4-7) and needsPermission (8-11), all floor. */
function layoutWith(overrides: Partial<OfficeLayout>): OfficeLayout {
  const room = (col: number) =>
    col < 4 ? "idle" : col < 8 ? "working" : "needsPermission";
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [],
    areas: ["idle", "working", "needsPermission"].map((label) => ({
      label,
      color: "#888888",
    })),
    areaTiles: Array.from({ length: COLS * ROWS }, (_, at) => room(at % COLS)),
    ...overrides,
  };
}

describe("the places a room gives its employees", () => {
  it("takes a listing room's places only from its list, in list order with pose and facing, and keeps chair seats elsewhere, typing only in Working", () => {
    // Given an idle room that lists three places and also holds a chair, a working room with a chair and a needs-permission room with a chair
    const office = loadOffice(
      layoutWith({
        furniture: [
          { uid: "idle-chair", type: "CUSHIONED_CHAIR_FRONT", col: 3, row: 2 },
          { uid: "work-chair", type: "CUSHIONED_CHAIR_FRONT", col: 5, row: 2 },
          { uid: "perm-chair", type: "CUSHIONED_CHAIR_FRONT", col: 9, row: 2 },
        ],
        spots: [
          { col: 1, row: 3, facing: "down", pose: "sit" },
          { col: 2, row: 4, facing: "up", pose: "read", standing: true },
          { col: 0, row: 5, facing: "left", pose: "stand" },
        ],
      }),
    );

    // When we read the seats of each room
    const seats = [...office.seats.entries()].map(([uid, seat]) => ({
      room: office.seatZone(uid),
      col: seat.seatCol,
      row: seat.seatRow,
      facing: seat.facingDir,
      pose: seat.pose,
      standing: seat.standing,
    }));

    // Then the idle room has exactly its three listed places, in order, and its chair is not a seat
    expect(seats.filter((seat) => seat.room === "idle")).toEqual([
      {
        room: "idle",
        col: 1,
        row: 3,
        facing: Direction.DOWN,
        pose: "sit",
        standing: false,
      },
      {
        room: "idle",
        col: 2,
        row: 4,
        facing: Direction.UP,
        pose: "read",
        standing: true,
      },
      {
        room: "idle",
        col: 0,
        row: 5,
        facing: Direction.LEFT,
        pose: "stand",
        standing: true,
      },
    ]);

    // And a chair outside a listing room is a seat, typing in Working and sitting still elsewhere
    expect(
      seats
        .filter((seat) => seat.room !== "idle")
        .map(({ room, pose }) => [room, pose]),
    ).toEqual([
      ["working", "type"],
      ["needsPermission", "sit"],
    ]);
  });
});

/** Sprites whose every frame names its set and index, so a test can tell which one was drawn. */
const SPRITES = Object.fromEntries(
  (["walk", "typing", "reading"] as const).map((set) => [
    set,
    Object.fromEntries(
      [0, 1, 2, 3].map((dir) => [
        dir,
        [0, 1, 2, 3].map((frame) => [[`${set}${frame}`]]),
      ]),
    ),
  ]),
) as unknown as CharacterSprites;
const drawn = (sprite: unknown) => (sprite as string[][])[0][0];

describe("an employee at its place", () => {
  const layout = () =>
    layoutWith({
      furniture: [
        { uid: "work-chair", type: "CUSHIONED_CHAIR_FRONT", col: 5, row: 2 },
      ],
      spots: [
        { col: 1, row: 3, facing: "down", pose: "sit" },
        { col: 2, row: 4, facing: "up", pose: "read", standing: true },
        { col: 0, row: 5, facing: "left", pose: "stand" },
      ],
    });

  /** The drawn frames over one second at a place, after walking there from the Working chair. */
  function settledAt(seatId: string) {
    const office = loadOffice(layout());
    office.addAgent(1, 0, 0, "work-chair", true);
    office.reassignSeat(1, seatId);
    for (let step = 0; step < 300; step++) office.update(0.1);
    const ch = office.characters.get(1);
    if (!ch) throw new Error("no employee");
    const frames = new Set<string>();
    for (let step = 0; step < 10; step++) {
      office.update(0.1);
      frames.add(drawn(getCharacterSprite(ch, SPRITES)));
    }
    return { ch, frames: [...frames] };
  }

  it("types with a moving frame only at a Working seat; elsewhere it sits still, holds a paper or stands, facing the place's way", () => {
    // When an employee sits at the Working chair, then another settles at each listed place
    const office = loadOffice(layout());
    office.addAgent(1, 0, 0, "work-chair", true);
    const ch = office.characters.get(1);
    if (!ch) throw new Error("no employee");
    const typing = new Set<string>();
    for (let step = 0; step < 10; step++) {
      office.update(0.1);
      typing.add(drawn(getCharacterSprite(ch, SPRITES)));
    }
    const sit = settledAt("spot:0");
    const read = settledAt("spot:1");
    const stand = settledAt("spot:2");

    // Then Working types through both typing frames
    expect([...typing].sort()).toEqual(["typing0", "typing1"]);

    // And the sofa sitter holds one typing frame facing down, without typing
    expect(sit.frames).toEqual(["typing0"]);
    expect([sit.ch.dir, sit.ch.standing]).toEqual([Direction.DOWN, false]);

    // And the reader holds one reading frame facing up, standing
    expect(read.frames).toEqual(["reading0"]);
    expect([read.ch.dir, read.ch.standing]).toEqual([Direction.UP, true]);

    // And the stander shows the standing walk frame facing left
    expect(stand.frames).toEqual(["walk1"]);
    expect([stand.ch.dir, stand.ch.standing]).toEqual([Direction.LEFT, true]);
  });
});

describe("a stay-put room", () => {
  const session = (n: number, state: "idle" | "working") => ({
    machineId: "m1",
    machineName: "Mac",
    sessionId: `s${n}`,
    cwd: "/w",
    state,
    startedAt: "2026-11-08T09:00:00.000Z",
    changedAt: "2026-11-08T10:00:00.000Z",
  });
  const layout = () =>
    layoutWith({
      stayPutRooms: ["idle"],
      furniture: [
        { uid: "work-chair", type: "CUSHIONED_CHAIR_FRONT", col: 5, row: 2 },
      ],
      spots: [
        { col: 1, row: 3, facing: "down", pose: "sit" },
        { col: 2, row: 4, facing: "up", pose: "read", standing: true },
        { col: 0, row: 5, facing: "left", pose: "stand" },
      ],
    });
  const at = (office: ReturnType<typeof loadOffice>) =>
    office
      .getCharacters()
      .map((ch) => `${ch.tileCol},${ch.tileRow}`)
      .sort();

  it("keeps its employees at their places for as long as they are there, and still lets one walk out when its state moves it to another room", () => {
    // Given three Idle employees at the room's three places
    const office = loadOffice(layout());
    const sync = createSceneSync(office, { smoothMs: 0 });
    const sessions = [0, 1, 2].map((n) => session(n, "idle"));
    sync.apply(sessions, { firstLoad: true });
    const places = at(office);
    expect(places).toEqual(["0,5", "1,3", "2,4"]);

    // When half an hour passes
    const visited = new Set<string>();
    for (let step = 0; step < 30 * 60 * 10; step++) {
      office.update(0.1);
      for (const tile of at(office)) visited.add(tile);
    }

    // Then none of them ever left its place
    expect([...visited].sort()).toEqual(places);

    // And when one starts working, it walks to the Working chair while the others stay
    sync.apply([session(0, "working"), ...sessions.slice(1)]);
    for (let step = 0; step < 300; step++) {
      office.update(0.1);
      sync.tick();
    }
    expect(at(office)).toEqual(["0,5", "2,4", "5,2"].sort());
  });
});

describe("an employee with no place in Working", () => {
  it("stands in the walk frame instead of typing at nothing", () => {
    // Given a Working room with no chair and one employee working in it
    const office = loadOffice(layoutWith({}));
    const sync = createSceneSync(office, { smoothMs: 0 });
    sync.apply(
      [
        {
          machineId: "m1",
          machineName: "Mac",
          sessionId: "s0",
          cwd: "/w",
          state: "working",
          startedAt: "2026-11-08T09:00:00.000Z",
          changedAt: "2026-11-08T10:00:00.000Z",
        },
      ],
      { firstLoad: true },
    );
    const ch = office.getCharacters()[0];

    // When a few seconds pass
    const frames = new Set<string>();
    for (let step = 0; step < 30; step++) {
      office.update(0.1);
      frames.add(drawn(getCharacterSprite(ch, SPRITES)));
    }

    // Then it shows only the standing walk frame, never a typing one
    expect([...frames]).toEqual(["walk1"]);
    expect(ch.standing).toBe(true);
  });
});
