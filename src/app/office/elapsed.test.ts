import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("writes seconds, minutes, hours and days in short form, and never below zero", () => {
    expect(
      [45_000, 65_000, 192_000, 3_900_000, 183_600_000, -5000].map(
        formatElapsed,
      ),
    ).toEqual(["45s", "1m 05s", "3m 12s", "1h 05m", "2d 3h", "0s"]);
  });
});
