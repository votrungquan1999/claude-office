import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("every start folder a Mac sees becomes a folder record", () => {
  const { setUpMac } = useMacHarness();

  it("keeps one record per folder with company mode on, and never flips a folder the owner switched off", async () => {
    // Given a folder the owner already switched company mode off for
    const db = await getDb();
    await db.collection("folders").insertOne({
      machineId: "machine-air",
      path: "/Users/q/ubet",
      companyMode: false,
      firstSeenAt: new Date(0),
    });
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");

    // When two sessions start in /Users/q/personal and one in the switched-off folder
    for (const [sessionId, cwd] of [
      ["a", "/Users/q/personal"],
      ["b", "/Users/q/personal"],
      ["c", "/Users/q/ubet"],
    ]) {
      mac.fake.addSession({ sessionId, cwd });
      await runHook(mac.fake.home, {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd,
        source: "startup",
      });
    }
    await mac.agent.flush();

    // Then each folder has exactly one record and the switch stays off
    const records = await db
      .collection("folders")
      .find({})
      .sort({ path: 1 })
      .toArray();
    expect(
      records.map(({ machineId, path, companyMode }) => ({
        machineId,
        path,
        companyMode,
      })),
    ).toEqual([
      {
        machineId: "machine-air",
        path: "/Users/q/personal",
        companyMode: true,
      },
      { machineId: "machine-air", path: "/Users/q/ubet", companyMode: false },
    ]);
  });
});
