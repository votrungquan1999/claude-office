import { describe, expect, it } from "vitest";
import { needsYouCount } from "./needs-you";

describe("the needs-you count", () => {
  it("adds Needs permission, Waiting for you and Review, and leaves out Working and Idle", () => {
    // Given a company with every kind of employee
    const counts = {
      working: 5,
      needsPermission: 2,
      waitingForYou: 3,
      review: 4,
      idle: 9,
    };

    // Then only the three rooms that ask something of the owner add up
    expect(needsYouCount(counts)).toBe(9);
  });
});
