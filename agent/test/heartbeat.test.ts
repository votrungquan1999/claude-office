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
});
