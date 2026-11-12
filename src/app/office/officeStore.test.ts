import { describe, expect, it } from "vitest";
import type { FolderDto } from "@/shared/folders";
import {
  acceptName,
  applyNames,
  applyOverrides,
  overrideKey,
  refuseName,
  settleNames,
  settleOverrides,
} from "./officeStore";

const folder = (
  path: string,
  companyMode: boolean,
  machineId = "m1",
): FolderDto => ({
  machineId,
  path,
  companyMode,
});

const pending = (name: string | null, token = 1) => ({
  name,
  token,
  storedAfterPoll: null,
});

describe("pending company-mode switches", () => {
  it("wins over an answer that still shows the old value, and is dropped only once an answer agrees", () => {
    // Given the owner switched /g off and an answer already in flight still says on
    const overrides = new Map([[overrideKey("m1", "/g"), false]]);
    const stale = [folder("/g", true), folder("/g", true, "m2")];

    // Then the switch stays off for that Mac only, and stays pending
    expect(applyOverrides(stale, overrides)).toEqual([
      folder("/g", false),
      folder("/g", true, "m2"),
    ]);
    expect(settleOverrides(overrides, stale).size).toBe(1);

    // When an answer agrees, the switch is settled and the record speaks for itself
    const agreed = [folder("/g", false), folder("/g", true, "m2")];
    expect(settleOverrides(overrides, agreed).size).toBe(0);
  });

  it("creates a record for a folder the answers do not know yet", () => {
    // Given a switch on a promoted child that has no record
    const overrides = new Map([[overrideKey("m1", "/g/a"), false]]);

    // Then the folder appears off, and stays pending until a record agrees
    expect(applyOverrides([folder("/g", false)], overrides)).toEqual([
      folder("/g", false),
      folder("/g/a", false),
    ]);
    expect(settleOverrides(overrides, [folder("/g", false)]).size).toBe(1);
  });
});

describe("pending company names", () => {
  it("wins over an answer that still shows the old name, for that Mac only, and is dropped once an answer agrees", () => {
    // Given the owner named /g on m1 while an answer in flight still has no name
    const names = new Map([[overrideKey("m1", "/g"), pending("Harbor")]]);
    const stale = [folder("/g", true), folder("/g", true, "m2")];

    // Then m1's record carries the name and the name stays pending
    expect(applyNames(stale, names)).toEqual([
      { ...folder("/g", true), displayName: "Harbor" },
      folder("/g", true, "m2"),
    ]);
    expect(settleNames(names, stale, 1).size).toBe(1);

    // When an answer agrees, the name is settled
    const agreed = [{ ...folder("/g", true), displayName: "Harbor" }];
    expect(settleNames(names, agreed, 2).size).toBe(0);
  });

  it("takes a name away when the pending value is null, and settles once the answer has no name", () => {
    // Given a reset pending on a named folder
    const names = new Map([[overrideKey("m1", "/g"), pending(null)]]);
    const named = [{ ...folder("/g", true), displayName: "Harbor" }];

    // Then the record loses its name and the reset stays pending
    expect(applyNames(named, names)).toEqual([folder("/g", true)]);
    expect(settleNames(names, named, 1).size).toBe(1);

    // When an answer has no name, the reset is settled
    expect(settleNames(names, [folder("/g", true)], 2).size).toBe(0);
  });

  it("adds no record for a pending reset on a folder that has none", () => {
    // Given a pending reset on a folder no answer knows
    const names = new Map([[overrideKey("m1", "/g/a"), pending(null, 1)]]);

    // Then there is nothing to reset, so no record appears
    expect(applyNames([], names)).toEqual([]);
  });

  it("makes one record, with company mode on, for a folder with no record, and one record when a switch is pending on it too", () => {
    // Given a name on a folder no answer knows
    const names = new Map([[overrideKey("m1", "/g/a"), pending("Billing")]]);

    // Then the folder appears named with company mode on
    expect(applyNames([folder("/g", true)], names)).toEqual([
      folder("/g", true),
      { ...folder("/g/a", true), displayName: "Billing" },
    ]);

    // And with a switch pending on the same folder, the name lands on that one record
    const switched = applyOverrides(
      [],
      new Map([[overrideKey("m1", "/g/a"), false]]),
    );
    expect(applyNames(switched, names)).toEqual([
      { ...folder("/g/a", false), displayName: "Billing" },
    ]);
  });

  it("once the server stored it, outlasts an answer to a poll started before, and is dropped by one started after, even when that answer shows another device's name", () => {
    // Given a name the server stored while poll 4 was in flight
    const key = overrideKey("m1", "/g");
    const names = acceptName(new Map([[key, pending("Harbor")]]), key, 1, 4);

    // When poll 4 answers with the old name, the name stays
    const stale = [folder("/g", true)];
    expect(settleNames(names, stale, 4).size).toBe(1);

    // When poll 5 answers with a name another device saved, that answer settles it
    const other = [{ ...folder("/g", true), displayName: "Dock" }];
    expect(settleNames(names, other, 5).size).toBe(0);
    expect(applyNames(other, settleNames(names, other, 5))).toEqual(other);
  });

  it("stays pending when an answer shows another name before the server stored it", () => {
    // Given a name still in flight and an answer with a different name
    const key = overrideKey("m1", "/g");
    const names = new Map([[key, pending("Harbor")]]);
    const other = [{ ...folder("/g", true), displayName: "Dock" }];

    // Then it keeps winning
    expect(settleNames(names, other, 1).size).toBe(1);
  });

  it("is not marked stored by an older request's success while a newer name is pending", () => {
    // Given request 2 owns the name
    const key = overrideKey("m1", "/g");
    const names = new Map([[key, pending("Yankee", 2)]]);

    // When request 1 is stored
    const after = acceptName(names, key, 1, 1);

    // Then request 2's name is still waiting for its own answer
    expect(after.get(key)).toEqual(pending("Yankee", 2));
  });
});

describe("a refused rename", () => {
  it("takes back its own name", () => {
    // Given request 1's name pending on a named folder
    const key = overrideKey("m1", "/g");
    const names = new Map([[key, pending("Zulu", 1)]]);
    const record = [{ ...folder("/g", true), displayName: "Alpha" }];

    // When request 1 is refused
    const reverted = refuseName(names, key, 1);

    // Then the folder shows its old name
    expect(applyNames(record, reverted)).toEqual(record);
  });

  it("leaves a newer request's name alone even when both carry the same value", () => {
    // Given request 3 renamed the company back to the name request 1 carried
    const key = overrideKey("m1", "/g");
    const names = new Map([[key, pending("Zulu", 3)]]);

    // When request 1 is refused
    const after = refuseName(names, key, 1);

    // Then request 3's name stays
    expect(after).toBe(names);
  });

  it("leaves no record behind on a company that had none", () => {
    // Given a name on a folder no answer knows
    const key = overrideKey("m1", "/g/a");
    const names = new Map([[key, pending("Billing", 1)]]);
    expect(applyNames([], names)).toHaveLength(1);

    // When the server refuses it
    const reverted = refuseName(names, key, 1);

    // Then no record is made up for the folder
    expect(applyNames([], reverted)).toEqual([]);
  });

  it("leaves a pending company-mode switch on the same folder in force", () => {
    // Given a switch and a name pending on one folder with no record
    const key = overrideKey("m1", "/g/a");
    const overrides = new Map([[key, false]]);
    const names = new Map([[key, pending("Billing", 1)]]);

    // When the name is refused
    const reverted = refuseName(names, key, 1);

    // Then the folder is still there, off
    expect(applyNames(applyOverrides([], overrides), reverted)).toEqual([
      folder("/g/a", false),
    ]);
  });
});
