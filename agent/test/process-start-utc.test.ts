import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";

/** Claude Code records `procStart` in UTC whatever the Mac's zone is. */
function utcStartOf(pid: number): string {
  return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })
    .replace(/\s+/g, " ")
    .trim();
}

describe("a Mac whose time zone is not UTC", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();
  const zone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Asia/Ho_Chi_Minh";
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("keeps a live session in the office when the registry start time is UTC, and brings back one the database shows as gone home", async () => {
    // Given live sessions whose registry start time is the UTC rendering
    const [kept, healed] = [await processes.live(), await processes.live()];
    const db = await getDb();
    // And the database shows one of them as gone home from an earlier run
    const endedAt = new Date(Date.now() - 60_000);
    await db.collection("sessions").insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      sessionId: "healed",
      cwd: "/work/healed",
      state: "wentHome",
      startedAt: new Date(endedAt.getTime() - 3_600_000),
      endedAt,
      expireAt: new Date(endedAt.getTime() + 7 * 86_400_000),
      changedAt: endedAt,
    });

    // When the agent starts
    const { agent } = await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        fake.addSession({
          sessionId: "kept",
          cwd: "/work/kept",
          pid: kept.pid,
          procStart: utcStartOf(kept.pid),
        });
        fake.addSession({
          sessionId: "healed",
          cwd: "/work/healed",
          pid: healed.pid,
          procStart: utcStartOf(healed.pid),
        });
      },
    });
    await agent.flush();

    // Then both are in the office, the gone-home one with no end time
    const ids = async () =>
      (await officeSessions()).map((s) => s.sessionId).sort();
    expect(await ids()).toEqual(["healed", "kept"]);
    const stored = await db
      .collection("sessions")
      .findOne({ sessionId: "healed" });
    expect(stored?.endedAt).toBeUndefined();
    expect(stored?.expireAt).toBeUndefined();

    // When the Mac checks its sessions again
    await agent.reconcile();
    await agent.flush();

    // Then they are still in the office
    expect(await ids()).toEqual(["healed", "kept"]);
  }, 60_000);
});
