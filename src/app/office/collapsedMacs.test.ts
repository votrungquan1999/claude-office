import { describe, expect, it } from "vitest";
import { parseCollapsedMacs } from "./collapsedMacs";

describe("parsing the stored folded Macs", () => {
  it("returns the stored machine ids", () => {
    // Given a stored list of two folded Macs
    const raw = JSON.stringify(["air", "mini"]);

    // When it is parsed
    const folded = parseCollapsedMacs(raw);

    // Then both Macs are folded
    expect([...folded]).toEqual(["air", "mini"]);
  });

  it("folds nothing for text that is not a list of machine ids", () => {
    // Given stored text that is garbage, not a list, or a list with a non-string
    const stored = ["not json", '{"air":true}', '["air", 3]', null];

    // When each is parsed
    const folded = stored.map((raw) => [...parseCollapsedMacs(raw)]);

    // Then none folds a Mac
    expect(folded).toEqual([[], [], [], []]);
  });
});
