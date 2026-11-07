import { describe, expect, it } from "vitest";
import { fitZoom } from "./fitZoom";

describe("fit-to-screen zoom", () => {
  it("picks the largest whole zoom at which the office fits both ways, within the zoom limits, and changes on rotation", () => {
    // Given an office 20 tiles wide and 30 tall (320 x 480 sprite px)
    const zoomFor = (w: number, h: number, dpr = 3) =>
      fitZoom(w, h, 20, 30, dpr);

    // Then a portrait phone fits at 3 (1179 / 320 = 3.7, 1800 / 480 = 3.75)
    expect(zoomFor(393, 600)).toBe(3);

    // And a shorter canvas is limited by its height (1200 / 480 = 2.5)
    expect(zoomFor(393, 400)).toBe(2);

    // And the same phone turned sideways is limited by its height (1179 / 480 = 2.4)
    expect(zoomFor(852, 393)).toBe(2);

    // And a 1x desktop screen is limited by its height (1600 / 320 = 5, 1200 / 480 = 2.5)
    expect(zoomFor(1600, 1200, 1)).toBe(2);

    // And the zoom never goes below 1 or above 10
    expect(zoomFor(50, 50)).toBe(1);
    expect(fitZoom(4000, 4000, 4, 4, 2)).toBe(10);
  });
});
