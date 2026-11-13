import { describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import type { SessionMap } from "../officeStore";
import {
  applyRanks,
  type PendingRanks,
  refuseRanks,
  settleRanks,
} from "./pendingRanks";

/** Sessions by key, each with an optional place. */
function sessions(
  ...rows: Array<[string, string | undefined, string?]>
): SessionMap {
  return new Map(
    rows.map(([id, rank, changedAt]) => [
      `m/${id}`,
      {
        machineId: "m",
        machineName: "Mac",
        sessionId: id,
        cwd: "/w",
        state: "idle",
        startedAt: "2026-11-01T00:00:00.000Z",
        changedAt: changedAt ?? "2026-11-01T00:00:00.000Z",
        ...(rank === undefined ? {} : { rank }),
      } satisfies SessionDto,
    ]),
  );
}

const pending = (
  ...rows: Array<[string, string, number, string?]>
): PendingRanks =>
  new Map(
    rows.map(([id, rank, token, movedAt]) => [
      `m/${id}`,
      { rank, token, movedAt: movedAt ?? "2026-11-05T00:00:00.000Z" },
    ]),
  );

describe("places pending on this device", () => {
  it("are laid over the sessions, leaving every other session and a session that is gone alone", () => {
    // Given sessions a (placed) and b (unplaced), and pending places for a and a session that is gone
    const shown = applyRanks(
      sessions(["a", "m"], ["b", undefined]),
      pending(["a", "t", 1], ["gone", "x", 1]),
    );

    // Then a shows the pending place, b is untouched, and nothing appears for the gone one
    expect([...shown].map(([key, s]) => [key, s.rank])).toEqual([
      ["m/a", "t"],
      ["m/b", undefined],
    ]);
  });

  it("are dropped once an answer shows the place, or shows the row changed after the move; an answer that is older than the move keeps them", () => {
    // Given three pending places, moved at 05:00
    const waiting = pending(["a", "t", 1], ["b", "t", 1], ["c", "t", 1]);

    // When an answer shows a at its pending place, b at another place changed after the move, and c as it was before the move
    const settled = settleRanks(
      waiting,
      sessions(
        ["a", "t", "2026-11-05T00:00:01.000Z"],
        ["b", "x", "2026-11-05T00:00:09.000Z"],
        ["c", undefined, "2026-11-04T00:00:00.000Z"],
      ),
    );

    // Then only c is still waiting
    expect([...settled.keys()]).toEqual(["m/c"]);
  });

  it("of a refused move are taken back, and the places of a newer move stay", () => {
    // Given an older move (token 1) of a and b, and a newer move (token 2) of b
    const waiting = pending(["a", "t", 1], ["b", "u", 2]);

    // When the older move is refused
    const left = refuseRanks(waiting, 1);

    // Then only the newer move's place remains
    expect([...left].map(([key, p]) => [key, p.rank])).toEqual([["m/b", "u"]]);
  });
});
