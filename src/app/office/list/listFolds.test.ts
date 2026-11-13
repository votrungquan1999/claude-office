import { describe, expect, it } from "vitest";
import { parseListFolds } from "./listFolds";

describe("the remembered section folds", () => {
  it("keeps each field the text holds readably and the default for the rest, and all defaults for unreadable text", () => {
    // Given stored text with one closed section, one wrong type, and garbage
    const partial = parseListFolds('{"needsYou":false,"everyone":"no"}');
    const garbage = parseListFolds("{not json");
    const empty = parseListFolds(null);

    // Then Needs you is closed, the rest are default, and garbage and nothing give the defaults
    expect(partial).toEqual({
      needsYou: false,
      everyone: true,
      wentHome: false,
    });
    const defaults = { needsYou: true, everyone: true, wentHome: false };
    expect(garbage).toEqual(defaults);
    expect(empty).toEqual(defaults);
  });
});
