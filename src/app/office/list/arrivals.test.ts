import { describe, expect, it } from "vitest";
import { hasArrival } from "./arrivals";

describe("a new needs-you arrival", () => {
  it("is a key that was not there before, and not the first look, a departure or a re-sort", () => {
    // Given the keys at the last look
    const before = new Set(["a", "b"]);

    // Then a new key arrives, while the first look, an unchanged set and a departure do not
    expect(hasArrival(before, new Set(["a", "b", "c"]))).toBe(true);
    expect(hasArrival(null, new Set(["a", "b"]))).toBe(false);
    expect(hasArrival(before, new Set(["b", "a"]))).toBe(false);
    expect(hasArrival(before, new Set(["a"]))).toBe(false);
  });
});
