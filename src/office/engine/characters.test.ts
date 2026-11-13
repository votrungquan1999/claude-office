import { describe, expect, it } from "vitest";
import { Direction, type Seat } from "../types";
import { createCharacter, isSeated, settleAtSeat } from "./characters";

const place = (standing: boolean): Seat => ({
  uid: "p1",
  seatCol: 3,
  seatRow: 4,
  facingDir: Direction.DOWN,
  assigned: true,
  pose: standing ? "stand" : "sit",
  standing,
});

describe("how an employee settled at a place is drawn", () => {
  it("sits lower only at a place with a chair, never at a standing place", () => {
    // Given one employee at a chair and one at a standing place
    const sitter = createCharacter(1, 0, null, null);
    const stander = createCharacter(2, 0, null, null);

    // When each settles at its place
    settleAtSeat(sitter, place(false));
    settleAtSeat(stander, place(true));

    // Then only the one at the chair gets the sitting offset
    expect(isSeated(sitter)).toBe(true);
    expect(isSeated(stander)).toBe(false);
  });
});
