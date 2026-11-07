import { describe, expect, it } from "vitest";
import type { SpriteData } from "../types";
import { getGreySprite } from "./spriteCache";

describe("grey sprite", () => {
  it("turns every coloured pixel grey, keeps its brightness order, and leaves empty pixels empty", () => {
    // Given a sprite with a red, a bright yellow and an empty pixel
    const sprite: SpriteData = [["#FF0000", "#FFFF00", ""]];

    // When it is greyed
    const [row] = getGreySprite(sprite);

    // Then the coloured pixels have equal red, green and blue, the yellow stays brighter, the empty one stays empty
    const channels = (hex: string) => [1, 3, 5].map((i) => hex.slice(i, i + 2));
    for (const pixel of row.slice(0, 2)) {
      const [r, g, b] = channels(pixel);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
    expect(Number.parseInt(row[1].slice(1, 3), 16)).toBeGreaterThan(
      Number.parseInt(row[0].slice(1, 3), 16),
    );
    expect(row[2]).toBe("");
  });
});
