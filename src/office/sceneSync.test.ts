import { describe, expect, it } from "vitest";
import { mergeSessions } from "@/app/office/officeStore";
import type { SessionDto } from "@/shared/session";
import { loadOffice } from "@/test/load-office";
import type { OfficeState } from "./engine/officeState";
import { createSceneSync } from "./sceneSync";

function session(
  machineId: string,
  machineName: string,
  sessionId: string,
  cwd: string,
  changedAt = "2026-11-08T10:00:00.000Z",
  state: SessionDto["state"] = "waiting",
): SessionDto {
  return {
    machineId,
    machineName,
    sessionId,
    cwd,
    state,
    startedAt: "2026-11-08T09:00:00.000Z",
    changedAt,
  };
}

describe("scene sync", () => {
  it("gives a session the same character look however the office was filled", () => {
    // Given the same eight sessions arriving in a different order and mix on two page loads
    const sessions = "abcdefgh"
      .split("")
      .map((id) => session("m1", "Mac", id, `/work/${id}`));
    const lookOf = (
      office: OfficeState,
      sync: ReturnType<typeof createSceneSync>,
    ) =>
      Object.fromEntries(
        sync.agentIds().map((id) => {
          const ch = office.characters.get(id);
          return [sync.sessionKeyOf(id), `${ch?.palette}/${ch?.hueShift}`];
        }),
      );
    const first = loadOffice();
    const firstSync = createSceneSync(first);
    const second = loadOffice();
    const secondSync = createSceneSync(second);

    // When each office is filled
    firstSync.apply(sessions, { firstLoad: true });
    secondSync.apply(
      [session("m2", "Other", "x", "/x"), ...[...sessions].reverse()],
      {
        firstLoad: true,
      },
    );

    // Then every shared session looks the same in both
    const a = lookOf(first, firstSync);
    const b = lookOf(second, secondSync);
    for (const key of Object.keys(a)) expect(b[key]).toBe(a[key]);
    // And the look is not one fixed skin
    expect(new Set(Object.values(a)).size).toBeGreaterThan(1);
  });

  it("adds one labelled employee per session on its own seat, once, and relabels when the folder changes", () => {
    // Given the office and sessions from two Macs
    const office = loadOffice();
    const sync = createSceneSync(office);
    const sessions = [
      session("m1", "Quan's MacBook Air", "a", "/Users/q/api"),
      session("m1", "Quan's MacBook Air", "b", "/Users/q/web"),
      session("m2", "Mac mini", "a", "/Users/q/docs"),
    ];

    // When they are applied, and applied again
    sync.apply(sessions, { firstLoad: true });
    const idsAfterFirst = sync.agentIds();
    sync.apply(sessions);

    // Then each session is one employee labelled "machine / folder" on a seat of its own
    const employees = office.getCharacters();
    expect(employees.map((ch) => ch.directoryName).sort()).toEqual([
      "Mac mini / docs",
      "Quan's MacBook Air / api",
      "Quan's MacBook Air / web",
    ]);
    expect(new Set(employees.map((ch) => ch.seatId)).size).toBe(3);
    expect(employees.every((ch) => ch.seatId !== null)).toBe(true);
    expect(sync.agentIds()).toEqual(idsAfterFirst);

    // When a session's folder changes
    sync.apply([
      session(
        "m1",
        "Quan's MacBook Air",
        "a",
        "/Users/q/api/server",
        "2026-11-08T10:01:00.000Z",
      ),
    ]);

    // Then the same employee shows the new folder
    expect(office.getCharacters()).toHaveLength(3);
    expect(office.getCharacters().map((ch) => ch.directoryName)).toContain(
      "Quan's MacBook Air / server",
    );
  });

  it("keeps the newest snapshot per machine and session when answers overlap", () => {
    // Given a stored snapshot
    const stored = mergeSessions(new Map(), [
      session("m1", "Mac", "a", "/new", "2026-11-08T10:05:00.000Z"),
    ]);

    // When an older replay and a different session arrive
    const merged = mergeSessions(stored, [
      session("m1", "Mac", "a", "/old", "2026-11-08T10:00:00.000Z"),
      session("m2", "Mac", "a", "/other", "2026-11-08T10:01:00.000Z"),
    ]);

    // Then the newer snapshot wins and the other session is kept apart
    expect(merged.get("m1/a")?.cwd).toBe("/new");
    expect(merged.get("m2/a")?.cwd).toBe("/other");
  });

  it("labels an employee with the desk name ahead of machine and folder, and follows a rename", () => {
    // Given a session with a desk name
    const office = loadOffice();
    const sync = createSceneSync(office);
    const named = {
      ...session("m1", "Mac mini", "a", "/Users/q/docs"),
      deskName: "Write the report",
    };
    sync.apply([named], { firstLoad: true });
    expect(office.getCharacters()[0].directoryName).toBe(
      "Write the report · Mac mini / docs",
    );

    // When the desk is renamed
    sync.apply([
      {
        ...named,
        deskName: "Card title",
        changedAt: "2026-11-08T10:01:00.000Z",
      },
    ]);

    // Then the label follows
    expect(office.getCharacters()[0].directoryName).toBe(
      "Card title · Mac mini / docs",
    );
  });

  describe("rooms", () => {
    /** The room an employee's seat is in. */
    function roomOf(office: OfficeState, sessionIndex: number): string | null {
      const employee = office.getCharacters()[sessionIndex];
      return employee.seatId ? office.seatZone(employee.seatId) : null;
    }

    it("seats each employee in the room of its state, and moves it only after the state held for two seconds", () => {
      // Given a clock we control and one session per state
      let now = 0;
      const office = loadOffice();
      const sync = createSceneSync(office, { now: () => now });
      const states = [
        "working",
        "thinking",
        "needsPermission",
        "waiting",
      ] as const;
      const sessions = states.flatMap((state) =>
        [0, 1].map((n) =>
          session(
            "m1",
            "Mac",
            `${state}-${n}`,
            "/w",
            "2026-11-08T10:00:00.000Z",
            state,
          ),
        ),
      );

      // When the office first loads
      sync.apply(sessions, { firstLoad: true });

      // Then every employee sits in the room of its state
      expect(office.getCharacters().map((_ch, i) => roomOf(office, i))).toEqual(
        sessions.map((s) => s.state),
      );

      // When the first session flips to thinking and the poll repeats after 1 s
      const flipped = {
        ...sessions[0],
        state: "thinking" as const,
        changedAt: "2026-11-08T10:00:01.000Z",
      };
      now = 1000;
      sync.apply([flipped]);

      // Then it has not moved yet
      expect(roomOf(office, 0)).toBe("working");

      // When the state has held for 2.5 s
      now = 3500;
      sync.apply([flipped]);

      // Then it sits in the thinking room
      expect(roomOf(office, 0)).toBe("thinking");
    });

    it("makes an employee stand on the floor of a full room instead of taking a seat in another room", () => {
      // Given a Working room with every seat taken
      const office = loadOffice();
      const sync = createSceneSync(office);
      const seatsInRoom = [...office.seats.keys()].filter(
        (uid) => office.seatZone(uid) === "working",
      ).length;
      const sessions = Array.from({ length: seatsInRoom + 1 }, (_, n) =>
        session(
          "m1",
          "Mac",
          `s${n}`,
          "/w",
          "2026-11-08T10:00:00.000Z",
          "working",
        ),
      );

      // When one more session starts working
      sync.apply(sessions, { firstLoad: true });

      // Then the extra employee has no seat and stands inside the Working room
      const standing = office
        .getCharacters()
        .filter((ch) => ch.seatId === null);
      expect(standing).toHaveLength(1);
      const { cols, areaTiles } = office.getLayout();
      const tileRoom =
        areaTiles?.[standing[0].tileRow * cols + standing[0].tileCol];
      expect(tileRoom).toBe("working");
    });

    it("makes a seated employee walk onto the floor of a full room and free its old seat", () => {
      // Given a full Working room and one employee seated in the Thinking room
      const office = loadOffice();
      const sync = createSceneSync(office, { smoothMs: 0 });
      const seatsInRoom = [...office.seats.keys()].filter(
        (uid) => office.seatZone(uid) === "working",
      ).length;
      const at = (n: number, state: SessionDto["state"], second: number) =>
        session(
          "m1",
          "Mac",
          `s${n}`,
          "/w",
          `2026-11-08T10:00:0${second}.000Z`,
          state,
        );
      const working = Array.from({ length: seatsInRoom }, (_, n) =>
        at(n, "working", 0),
      );
      sync.apply([...working, at(seatsInRoom, "thinking", 0)], {
        firstLoad: true,
      });
      const walker = office.getCharacters()[seatsInRoom];
      const oldSeatId = walker.seatId;
      expect(oldSeatId).not.toBeNull();

      // When it starts working and has finished walking
      sync.apply([...working, at(seatsInRoom, "working", 1)]);
      for (let step = 0; step < 600 && walker.path.length > 0; step++) {
        office.update(0.1);
      }

      // Then it stands in the Working room without a seat and its old seat is free
      expect(walker.path).toHaveLength(0);
      expect(walker.seatId).toBeNull();
      const { cols, areaTiles } = office.getLayout();
      expect(areaTiles?.[walker.tileRow * cols + walker.tileCol]).toBe(
        "working",
      );
      expect(office.seats.get(oldSeatId as string)?.assigned).toBe(false);
    });

    it("shows the state on the employee: busy while working or thinking, a permission bubble that stays until the dialog closes, idle when waiting", () => {
      // Given one employee
      const office = loadOffice();
      const sync = createSceneSync(office, { smoothMs: 0 });
      const at = (state: SessionDto["state"], second: number) =>
        session(
          "m1",
          "Mac",
          "a",
          "/w",
          `2026-11-08T10:00:0${second}.000Z`,
          state,
        );
      const employee = () => office.getCharacters()[0];
      sync.apply([at("waiting", 0)], { firstLoad: true });
      expect(employee().isActive).toBe(false);

      // When it works and then thinks, it is busy
      sync.apply([at("working", 1)]);
      expect(employee().isActive).toBe(true);
      sync.apply([at("thinking", 2)]);
      expect(employee().isActive).toBe(true);

      // When it needs permission, it shows the bubble, and a poll puts it back if something cleared it
      sync.apply([at("needsPermission", 3)]);
      expect(employee().bubbleType).toBe("permission");
      office.clearPermissionBubble(employee().id);
      sync.apply([at("needsPermission", 3)]);
      expect(employee().bubbleType).toBe("permission");

      // When the turn is done, the bubble goes and the employee is idle
      sync.apply([at("waiting", 4)]);
      expect(employee().bubbleType).toBeNull();
      expect(employee().isActive).toBe(false);
    });

    it("finishes a delayed move on a later tick even when the poll sends nothing new for that session", () => {
      // Given an employee in the Working room whose state just flipped to thinking
      let now = 0;
      const office = loadOffice();
      const sync = createSceneSync(office, { now: () => now });
      const base = session(
        "m1",
        "Mac",
        "a",
        "/w",
        "2026-11-08T10:00:00.000Z",
        "working",
      );
      sync.apply([base], { firstLoad: true });
      now = 100;
      sync.apply([
        { ...base, state: "thinking", changedAt: "2026-11-08T10:00:01.000Z" },
      ]);
      expect(roomOf(office, 0)).toBe("working");

      // When two seconds pass and only the clock ticks
      now = 2500;
      sync.tick();

      // Then the employee has moved to the thinking room
      expect(roomOf(office, 0)).toBe("thinking");
    });
  });

  describe("went-home sessions", () => {
    it("removes the employee and frees its seat when a session goes home, never adds one for an ended session, and brings it back on resume", () => {
      // Given two live employees
      const office = loadOffice();
      const sync = createSceneSync(office);
      const a = session("m1", "Mac", "a", "/a", "2026-11-08T10:00:00.000Z");
      const b = session("m1", "Mac", "b", "/b", "2026-11-08T10:00:00.000Z");
      sync.apply([a, b], { firstLoad: true });
      const seatOfA = office.getCharacters()[0].seatId as string;
      const goneKey = sync.sessionKeyOf(sync.agentIds()[0]);
      expect(goneKey).toBe("m1/a");

      // When the first session goes home and the renderer finishes its despawn
      const home = (id: SessionDto): SessionDto => ({
        ...id,
        state: "wentHome",
        endedAt: "2026-11-08T11:00:00.000Z",
        changedAt: "2026-11-08T11:00:00.000Z",
      });
      sync.apply([home(a)]);
      for (let step = 0; step < 100; step++) office.update(0.1);

      // Then only the second employee is left, the seat is free, and the key mapping is gone
      expect(office.getCharacters()).toHaveLength(1);
      expect(office.seats.get(seatOfA)?.assigned).toBe(false);
      expect(sync.agentIds()).toHaveLength(1);
      expect(sync.sessionKeyOf(1)).toBeUndefined();

      // When an ended session is applied on first load and in a later poll
      const c = session("m1", "Mac", "c", "/c", "2026-11-08T10:00:00.000Z");
      sync.apply([home(c)], { firstLoad: true });
      sync.apply([home(c)]);

      // Then nobody is added for it
      expect(office.getCharacters()).toHaveLength(1);

      // When the first session is resumed right after going home
      sync.apply([
        { ...a, state: "thinking", changedAt: "2026-11-08T12:00:00.000Z" },
      ]);

      // Then it is an employee again
      expect(office.getCharacters()).toHaveLength(2);
      expect(
        sync
          .agentIds()
          .map((id) => sync.sessionKeyOf(id))
          .sort(),
      ).toEqual(["m1/a", "m1/b"]);
    });
  });

  it("marks the employees of an offline Mac and clears the mark when the Mac is back", () => {
    // Given employees on two Macs
    const office = loadOffice();
    const sync = createSceneSync(office);
    const sessions = [
      session("m1", "Air", "a", "/Users/q/api"),
      session("m2", "Mini", "b", "/Users/q/docs"),
    ];
    const offlineByMachine = () =>
      Object.fromEntries(
        office
          .getCharacters()
          .map((ch) => [
            sync.sessionKeyOf(ch.id)?.split("/")[0],
            ch.macOffline === true,
          ]),
      );

    // When the Mini is offline
    sync.apply(sessions, {
      firstLoad: true,
      offlineMachineIds: new Set(["m2"]),
    });

    // Then only its employee is marked
    expect(offlineByMachine()).toEqual({ m1: false, m2: true });

    // When nothing is offline any more
    sync.apply(sessions, { offlineMachineIds: new Set() });

    // Then no one is marked
    expect(offlineByMachine()).toEqual({ m1: false, m2: false });
  });
});
