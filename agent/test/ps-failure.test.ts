import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";

describe("starting the agent when the process list cannot be read", () => {
  const { setUpMac } = useMacHarness();
  const emptyBin = mkdtempSync(join(tmpdir(), "claude-office-nopath-"));
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to start with a clear reason and tells the office nothing about this Mac", async () => {
    // Given a Mac where `ps` cannot be run
    vi.stubEnv("PATH", emptyBin);

    // When the agent starts
    const started = setUpMac("machine-nops", "No-ps Mac");

    // Then it fails with a reason an operator can read in the log
    await expect(started).rejects.toThrow(/could not read the process list/i);
    // And it never marked the Mac as alive
    const machines = (await getDb()).collection("machines");
    expect(await machines.countDocuments({ machineId: "machine-nops" })).toBe(
      0,
    );
    rmSync(emptyBin, { recursive: true, force: true });
  });
});
