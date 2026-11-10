import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";

describe("the agent tells the office which known folders still exist", () => {
  const { setUpMac } = useMacHarness();

  /** The Mac's folder records by path, with only the field under test. */
  async function existence(machineId: string) {
    const records = await (await getDb())
      .collection("folders")
      .find({ machineId })
      .toArray();
    return Object.fromEntries(
      records.map((record) => [record.path, record.existsOnMac]),
    );
  }

  it("marks a deleted folder missing on the next beat, marks it present again once recreated, and leaves another Mac's records alone", async () => {
    // Given known folders on two Macs, one of this Mac's folders on disk, and another Mac's record for a path that exists nowhere
    const mac = await setUpMac("machine-air", "Air");
    const kept = mac.fake.makeFolder("kept");
    const doomed = mac.fake.makeFolder("doomed");
    const db = await getDb();
    await db.collection("folders").insertMany(
      [
        ["machine-air", kept],
        ["machine-air", doomed],
        ["machine-mini", "/mini/only"],
      ].map(([machineId, path]) => ({
        machineId,
        path,
        companyMode: true,
        firstSeenAt: new Date(),
      })),
    );

    // When the next beat runs
    await mac.agent.heartbeat();

    // Then this Mac's existing folders read present and the other Mac's record is untouched
    expect(await existence("machine-air")).toEqual({
      [kept]: true,
      [doomed]: true,
    });
    expect(await existence("machine-mini")).toEqual({
      "/mini/only": undefined,
    });

    // When a folder is deleted, then recreated
    rmSync(doomed, { recursive: true });
    await mac.agent.heartbeat();
    expect((await existence("machine-air"))[doomed]).toBe(false);
    mac.fake.makeFolder("doomed");
    await mac.agent.heartbeat();

    // Then it reads present again
    expect((await existence("machine-air"))[doomed]).toBe(true);
  });
});
