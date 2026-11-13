import { describe, expect, it } from "vitest";
import { sortByListOrder } from "./list-order";

/** A row with only what the order reads. */
function row(sessionId: string, startedAt: string, rank?: string) {
  return {
    machineId: "m",
    sessionId,
    startedAt,
    ...(rank === undefined ? {} : { rank }),
  };
}

describe("the owner's list order", () => {
  it("puts rows with no place on top newest first, then the rest by rank by character code, equal ranks by key", () => {
    // Given ranked and unranked conversations in no particular order
    const rows = [
      row("ranked-b", "2026-11-01T00:00:00.000Z", "b"),
      row("old-unranked", "2026-11-02T00:00:00.000Z"),
      row("ranked-upper", "2026-11-01T00:00:00.000Z", "B"),
      row("tie-z", "2026-11-01T00:00:00.000Z", "m"),
      row("new-unranked", "2026-11-05T00:00:00.000Z"),
      row("tie-a", "2026-11-01T00:00:00.000Z", "m"),
    ];

    // When they are put in the owner's order
    const ids = sortByListOrder(rows).map((r) => r.sessionId);

    // Then unranked come first newest first, ranked follow by plain character code with ties by key
    expect(ids).toEqual([
      "new-unranked",
      "old-unranked",
      "ranked-upper",
      "ranked-b",
      "tie-a",
      "tie-z",
    ]);
  });
});
