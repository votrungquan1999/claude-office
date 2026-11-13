import { describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import type { SessionMap } from "../officeStore";
import {
  acceptRanks,
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
  ...rows: Array<[string, string, number, (number | null)?]>
): PendingRanks =>
  new Map(
    rows.map(([id, rank, token, storedAfterPoll]) => [
      `m/${id}`,
      { rank, token, storedAfterPoll: storedAfterPoll ?? null },
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

  it("stay while the save is in flight, whatever an answer shows, including a newer change of the row", () => {
    // Given a place whose save has not returned
    const waiting = pending(["a", "t", 1]);

    // When a poll answers with the old place and a change made after the move (an agent step)
    const settled = settleRanks(
      waiting,
      sessions(["a", "m", "2026-11-09T00:00:00.000Z"]),
      3,
    );

    // Then the pending place is still in force
    expect([...settled.keys()]).toEqual(["m/a"]);
  });

  it("stay until a poll that started after the save answers, then the answer is the truth", () => {
    // Given places saved when poll 3 was the last started
    const waiting = pending(["a", "t", 1, 3]);
    const old = sessions(["a", "m"]);

    // Then the answers of polls 2 and 3 keep it
    expect([...settleRanks(waiting, old, 2).keys()]).toEqual(["m/a"]);
    expect([...settleRanks(waiting, old, 3).keys()]).toEqual(["m/a"]);

    // And poll 4's answer drops it, even though it shows another place
    expect([...settleRanks(waiting, old, 4).keys()]).toEqual([]);
  });

  it("are dropped when the session is gone", () => {
    expect([
      ...settleRanks(pending(["a", "t", 1]), sessions(["b", "m"]), 3).keys(),
    ]).toEqual([]);
  });

  it("are marked stored for the move that was saved, leaving a newer move alone", () => {
    // Given an older move (token 1) of a and a newer move (token 2) of b
    const waiting = pending(["a", "t", 1], ["b", "u", 2]);

    // When the server stored move 1 with poll 5 the last started
    const marked = acceptRanks(waiting, 1, 5);

    // Then only a records poll 5
    expect([...marked].map(([key, p]) => [key, p.storedAfterPoll])).toEqual([
      ["m/a", 5],
      ["m/b", null],
    ]);
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
