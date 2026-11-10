import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { pause } from "./run-hook";

describe("a Mac says it is still here", () => {
  const { setUpMac } = useMacHarness();

  it("stamps its last-seen time when it starts and again on every heartbeat", async () => {
    // Given a Mac whose agent has just started
    const { agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const machines = (await getDb()).collection("machines");

    // Then it is already on record with the server's clock
    const started = await machines.findOne({ machineId: "machine-air" });
    expect(started?.machineName).toBe("Quan's MacBook Air");
    expect(started?.lastSeenAt).toBeInstanceOf(Date);
    expect(Math.abs(started?.lastSeenAt.getTime() - Date.now())).toBeLessThan(
      10_000,
    );

    // When the next heartbeat comes
    await pause(20);
    await agent.heartbeat();

    // Then the time moved forward and there is still one record for the Mac
    const beat = await machines.findOne({ machineId: "machine-air" });
    expect(beat?.lastSeenAt.getTime()).toBeGreaterThan(
      started?.lastSeenAt.getTime(),
    );
    expect(await machines.countDocuments({ machineId: "machine-air" })).toBe(1);
  }, 60_000);

  it("reports the agent's version with every heartbeat, the repo's own by default", async () => {
    // Given a Mac on the default version and one told to report another
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    await setUpMac("machine-air", "Air");
    const mini = await setUpMac("machine-mini", "Mini", {
      agentVersion: "9.9.9",
    });
    const machines = (await getDb()).collection("machines");

    // Then each record carries the version, and it is rewritten on the next beat
    expect(
      (await machines.findOne({ machineId: "machine-air" }))?.agentVersion,
    ).toBe(pkg.version);
    await machines.updateOne(
      { machineId: "machine-mini" },
      { $unset: { agentVersion: "" } },
    );
    await mini.agent.heartbeat();
    expect(
      (await machines.findOne({ machineId: "machine-mini" }))?.agentVersion,
    ).toBe("9.9.9");
  }, 60_000);
});
