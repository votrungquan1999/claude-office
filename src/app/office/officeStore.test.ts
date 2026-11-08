import { describe, expect, it } from "vitest";
import type { FolderDto } from "@/shared/folders";
import { applyOverrides, overrideKey, settleOverrides } from "./officeStore";

const folder = (
  path: string,
  companyMode: boolean,
  machineId = "m1",
): FolderDto => ({
  machineId,
  path,
  companyMode,
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
