import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const WEEK_SECONDS = 7 * 86_400;

describe("what a Mac that goes quiet leaves behind expires a week after it was last seen", () => {
  const { setUpMac } = useMacHarness();

  it("stamps live sessions and the machine with a last-seen time that a 7-day expiry index watches", async () => {
    // Given a Mac with one open session
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/work/app",
      source: "startup",
    });

    // When its state is written
    await agent.flush();

    // Then the session and the machine carry a last-seen time
    const db = await getDb();
    const session = await db.collection("sessions").findOne({});
    const machine = await db.collection("machines").findOne({});
    expect(session?.lastSeenAt).toBeInstanceOf(Date);
    expect(session?.endedAt).toBeUndefined();
    expect(machine?.lastSeenAt).toBeInstanceOf(Date);

    // And both collections expire documents 7 days after that time
    for (const name of ["sessions", "machines"]) {
      const indexes = await db.collection(name).indexes();
      expect(
        indexes.find((index) => index.key.lastSeenAt === 1)?.expireAfterSeconds,
      ).toBe(WEEK_SECONDS);
    }
  }, 60_000);

  it("keeps an idle open session alive while its Mac keeps beating, without touching ended ones or announcing a change", async () => {
    // Given an open and an ended session of this Mac, both last written 6 days ago
    const { agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const db = await getDb();
    const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000);
    const base = {
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      cwd: "/work/app",
      state: "waiting",
      startedAt: sixDaysAgo,
      changedAt: sixDaysAgo,
      lastSeenAt: sixDaysAgo,
    };
    await db.collection("sessions").insertMany([
      { ...base, sessionId: "open" },
      { ...base, sessionId: "ended", state: "wentHome", endedAt: sixDaysAgo },
    ]);

    // When the Mac's heartbeat fires
    await agent.heartbeat();

    // Then the open session is seen now, and nothing else moved
    const open = await db.collection("sessions").findOne({ sessionId: "open" });
    const ended = await db
      .collection("sessions")
      .findOne({ sessionId: "ended" });
    expect(Date.now() - open?.lastSeenAt.getTime()).toBeLessThan(60_000);
    expect(open?.changedAt).toEqual(sixDaysAgo);
    expect(ended?.lastSeenAt).toEqual(sixDaysAgo);
  }, 60_000);
});
