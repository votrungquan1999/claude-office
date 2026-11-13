import { describe, expect, it } from "vitest";
import {
  moveTo,
  ordinal,
  placeOf,
  type RankAssignment,
  rankBetween,
  sortByListOrder,
} from "./list-order";
import { RANK_MAX_LENGTH } from "./session";

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

describe("a rank between two others", () => {
  it("sorts strictly between its neighbours however close they are, never ends in a, and is refused when the neighbours are out of order", () => {
    // Given pairs of neighbours, open at either end, close together, nested and one a prefix of the other
    const pairs: Array<[string | null, string | null]> = [
      [null, null],
      [null, "b"],
      [null, "ab"],
      ["z", null],
      ["zz", null],
      ["b", "c"],
      ["b", "bb"],
      ["m", "mb"],
      ["abz", "ac"],
      ["n", "o"],
    ];

    // When a rank is made for each, and again between each rank and its upper neighbour many times over
    const results = pairs.map(([low, high]) => rankBetween(low, high));
    let low = "n";
    for (let i = 0; i < 30; i++) {
      const next = rankBetween(low, "o") as string;
      expect(next > low && next < "o").toBe(true);
      low = next;
    }

    // Then every one sorts strictly between its neighbours and none ends in a
    pairs.forEach(([lowRank, highRank], i) => {
      const rank = results[i] as string;
      expect(rank).toMatch(/^[a-z]*[b-z]$/);
      if (lowRank !== null) expect(rank > lowRank).toBe(true);
      if (highRank !== null) expect(rank < highRank).toBe(true);
    });

    // And neighbours that are equal or out of order get none
    expect(rankBetween("c", "b")).toBeNull();
    expect(rankBetween("m", "m")).toBeNull();
  });
});

/** The order the rows take once the saved places are applied. */
function orderAfter<T extends { machineId: string; sessionId: string }>(
  rows: T[],
  assignments: RankAssignment[],
): string[] {
  const placed = rows.map((r) => {
    const hit = assignments.find((a) => a.sessionId === r.sessionId);
    return hit ? { ...r, rank: hit.rank } : r;
  });
  return sortByListOrder(
    placed as Array<T & { startedAt: string; rank?: string }>,
  ).map((r) => r.sessionId);
}

describe("moving a row", () => {
  it("with no places yet gives every row a place in its current order, so the moved row alone changes place", () => {
    // Given four rows that all have no place yet, newest first
    const rows = ["d", "c", "b", "a"].map((id, i) =>
      row(id, `2026-11-0${5 - i}T00:00:00.000Z`),
    );
    const ordered = sortByListOrder(rows);
    expect(ordered.map((r) => r.sessionId)).toEqual(["d", "c", "b", "a"]);

    // When the last row is moved to the top
    const assignments = moveTo(ordered, "m/a", 0);

    // Then every row got a place, and the order is the moved row then the rest as before
    expect(assignments.map((a) => a.sessionId).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(orderAfter(rows, assignments)).toEqual(["a", "d", "c", "b"]);
  });

  it("keeps the places of rows that already have one, and places only the moved row and the rows with no place", () => {
    // Given two rows with no place, then three placed ones
    const rows = [
      row("u2", "2026-11-05T00:00:00.000Z"),
      row("u1", "2026-11-04T00:00:00.000Z"),
      row("r1", "2026-11-01T00:00:00.000Z", "b"),
      row("r2", "2026-11-01T00:00:00.000Z", "d"),
      row("r3", "2026-11-01T00:00:00.000Z", "f"),
    ];
    const ordered = sortByListOrder(rows);

    // When the last row moves between the two unplaced ones
    const assignments = moveTo(ordered, "m/r3", 1);

    // Then the placed rows in the middle keep their places, and the order is as dropped
    expect(assignments.map((a) => a.sessionId).sort()).toEqual([
      "r3",
      "u1",
      "u2",
    ]);
    expect(orderAfter(rows, assignments)).toEqual([
      "u2",
      "r3",
      "u1",
      "r1",
      "r2",
    ]);
  });

  it("saves nothing when the row is dropped where it already is", () => {
    // Given placed rows
    const ordered = sortByListOrder([
      row("a", "2026-11-01T00:00:00.000Z", "b"),
      row("b", "2026-11-01T00:00:00.000Z", "d"),
      row("c", "2026-11-01T00:00:00.000Z", "f"),
    ]);

    // When the middle row is dropped at its own place
    // Then nothing is to be saved
    expect(moveTo(ordered, "m/b", 1)).toEqual([]);
  });

  it("puts the moved row after its visible neighbour while the hidden rows keep their order", () => {
    // Given five placed rows where b and d are hidden by a filter
    const rows = ["a", "b", "c", "d", "e"].map((id, i) =>
      row(id, "2026-11-01T00:00:00.000Z", "bcdef"[i]),
    );
    const ordered = sortByListOrder(rows);
    const hidden = new Set(["b", "d"]);
    const visible = (r: { sessionId: string }) => !hidden.has(r.sessionId);

    // When the owner drops e (shown rows: a c e) between a and c, at visible index 1
    const assignments = moveTo(ordered, "m/e", 1, visible);

    // Then only e changes place and it lands right after a, before the hidden b
    expect(assignments.map((a) => a.sessionId)).toEqual(["e"]);
    expect(orderAfter(rows, assignments)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("places every row afresh when two neighbours have the same place and leave no room between them", () => {
    // Given three rows where two share a place
    const rows = [
      row("a", "2026-11-01T00:00:00.000Z", "m"),
      row("b", "2026-11-01T00:00:00.000Z", "m"),
      row("c", "2026-11-01T00:00:00.000Z", "z"),
    ];
    const ordered = sortByListOrder(rows);

    // When c is moved between the two
    const assignments = moveTo(ordered, "m/c", 1);

    // Then every row is placed, and the order is as dropped
    expect(assignments.map((a) => a.sessionId).sort()).toEqual(["a", "b", "c"]);
    expect(orderAfter(rows, assignments)).toEqual(["a", "c", "b"]);
    expect(new Set(assignments.map((a) => a.rank)).size).toBe(3);
  });

  it("keeps every place within the length limit and the order as dropped after 400 moves in a row to the top, and to the bottom", () => {
    for (const edge of ["top", "bottom"] as const) {
      // Given four rows that already have places
      let rows = ["a", "b", "c", "d"].map((id, i) =>
        row(id, "2026-11-01T00:00:00.000Z", "bcde"[i]),
      );
      for (let move = 0; move < 400; move++) {
        // When the row at the far end is moved to the other end
        const ordered = sortByListOrder(rows);
        const mover = edge === "top" ? ordered[3] : ordered[0];
        const assignments = moveTo(
          ordered,
          `m/${mover.sessionId}`,
          edge === "top" ? 0 : 3,
        );
        const rankOf = new Map(
          assignments.map((a) => [a.sessionId, a.rank] as const),
        );
        rows = rows.map((r) => ({
          ...r,
          rank: rankOf.get(r.sessionId) ?? r.rank,
        }));

        // Then every place fits the server's limit and the mover sits at the chosen end
        expect(
          Math.max(...rows.map((r) => r.rank?.length ?? 0)),
        ).toBeLessThanOrEqual(RANK_MAX_LENGTH);
        const after = sortByListOrder(rows).map((r) => r.sessionId);
        expect(after[edge === "top" ? 0 : 3]).toBe(mover.sessionId);
      }
    }
  });
});

describe("the place of a row", () => {
  it("is its position and the company's total, and none for a row that is not listed", () => {
    // Given three rows in the owner's order
    const rows = sortByListOrder([
      row("a", "2026-11-01T00:00:00.000Z", "b"),
      row("b", "2026-11-01T00:00:00.000Z", "c"),
      row("c", "2026-11-01T00:00:00.000Z", "d"),
    ]);

    // When the place of the second and of a stranger is asked
    const second = placeOf(rows, "m/b");
    const stranger = placeOf(rows, "m/zzz");

    // Then the second is index 1 of 3 and the stranger has none
    expect(second).toEqual({ index: 1, total: 3 });
    expect(stranger).toBeNull();
  });

  it("is written as an ordinal, with the teens and 21st, 22nd, 23rd right", () => {
    // Given numbers around the irregular endings
    const written = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal);

    // Then each reads as English does
    expect(written).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
    ]);
  });
});
