import { describe, expect, it } from "vitest";
import { loadOffice } from "@/test/load-office";
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

  it("keeps the real office readable (zoom 2 or more) on a desktop, a portrait phone and a sideways phone", () => {
    // Given the generated office and the height the 56 px company strip takes
    const { cols, rows } = loadOffice().getLayout();
    const STRIP = 56;
    const CARD_BAR = 66;
    const zoomFor = (w: number, h: number, dpr: number) =>
      fitZoom(w, h, cols, rows, dpr);

    // Then desktop screens at 1x fit it at zoom 2 or more
    expect(zoomFor(1280, 800 - STRIP, 1)).toBeGreaterThanOrEqual(2);
    expect(zoomFor(1440, 900 - STRIP, 1)).toBeGreaterThanOrEqual(2);

    // And a portrait phone fits it at zoom 2 or more
    expect(zoomFor(393, 852, 3)).toBeGreaterThanOrEqual(2);

    // And a sideways phone, with its card bar and strip taken off, still does
    expect(zoomFor(852, 393 - CARD_BAR - STRIP, 3)).toBeGreaterThanOrEqual(2);
  });
});
