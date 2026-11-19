import { describe, expect, it } from "vitest";
import { parseListFolds } from "./listFolds";

describe("the remembered section folds", () => {
  it("keeps each field the text holds readably and the default for the rest, and all defaults for unreadable text", () => {
    // Given stored text with one closed section, one wrong type, and garbage
    const partial = parseListFolds('{"needsYou":false,"everyone":"no"}');
    const garbage = parseListFolds("{not json");
    const empty = parseListFolds(null);

    // Then Needs you is closed, the rest are default, and garbage and nothing give the defaults: In other companies starts folded
    expect(partial).toEqual({
      needsYou: false,
      otherCompanies: false,
      everyone: true,
      wentHome: false,
    });
    const defaults = {
      needsYou: true,
      otherCompanies: false,
      everyone: true,
      wentHome: false,
    };
    expect(garbage).toEqual(defaults);
    expect(empty).toEqual(defaults);
  });

  it("remembers the other companies' fold on its own, apart from Needs you", () => {
    // Given stored text that opens only "In other companies"
    const folds = parseListFolds('{"otherCompanies":true}');

    // Then that section is open and Needs you keeps its default
    expect(folds.otherCompanies).toBe(true);
    expect(folds.needsYou).toBe(true);
  });
});
