import { describe, expect, it } from "vitest";
import { mergeSessions } from "@/app/office/officeStore";
import type { SessionDto } from "@/shared/session";
import { loadOffice } from "@/test/load-office";
import { createSceneSync } from "./sceneSync";

function session(
  machineId: string,
  machineName: string,
  sessionId: string,
  cwd: string,
  changedAt = "2026-11-08T10:00:00.000Z",
): SessionDto {
  return {
    machineId,
    machineName,
    sessionId,
    cwd,
    state: "waiting",
    startedAt: "2026-11-08T09:00:00.000Z",
    changedAt,
  };
}

describe("scene sync", () => {
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
});
