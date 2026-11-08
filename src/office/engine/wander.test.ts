import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOffice } from "@/test/load-office";
import { createSceneSync } from "../sceneSync";

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
      [0, 1, 2].map((n) => ({
        machineId: "m1",
        machineName: "Mac",
        sessionId: `s${n}`,
        cwd: "/w",
        state: "idle" as const,
        startedAt: "2026-11-08T09:00:00.000Z",
        changedAt: "2026-11-08T10:00:00.000Z",
      })),
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
