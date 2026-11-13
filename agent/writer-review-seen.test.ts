import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";
import { SessionWriter } from "./writer";

describe("the owner's Review-to-Idle mark on a stored session", () => {
  useTestMongo();

  it("survives the agent republishing the session, with or without steps", async () => {
    // Given a stored Review the owner moved to Idle
    const db = await getDb();
    const sessions = db.collection("sessions");
    await sessions.deleteMany({});
    const reviewSince = new Date("2026-11-08T10:00:00.000Z");
    const clearedAt = new Date("2026-11-08T10:05:00.000Z");
    await sessions.insertOne({
      machineId: "m1",
      machineName: "Mac",
      sessionId: "s1",
      cwd: "/work",
      state: "review",
      stateSince: reviewSince,
      reviewSeenAt: reviewSince,
      reviewClearedAt: clearedAt,
      startedAt: new Date(0),
      changedAt: new Date(0),
    });
    const writer = new SessionWriter(sessions, db.collection("steps"), {
      flushMs: 0,
      maxOpsPerSecond: 1000,
      now: Date.now,
      log: () => {},
    });
    const snapshot = {
      machineId: "m1",
      machineName: "Mac",
      sessionId: "s1",
      cwd: "/work",
      state: "review" as const,
      stateSince: reviewSince,
      startedAt: new Date(0),
    };

    // When the agent republishes the same Review, then again with a finished step
    writer.submit(snapshot);
    await writer.flush();
    writer.submit({ ...snapshot, cwd: "/work/b" }, [
      {
        _id: new ObjectId(),
        machineId: "m1",
        sessionId: "s1",
        text: "step",
        startedAt: new Date(1_700_000_000_000),
        durationMs: 10,
        status: "ok",
      },
    ]);
    await writer.flush();
    writer.stop();

    // Then the mark is still on the row
    const stored = await sessions.findOne({ sessionId: "s1" });
    expect(stored?.cwd).toBe("/work/b");
    expect([stored?.reviewSeenAt, stored?.reviewClearedAt]).toEqual([
      reviewSince,
      clearedAt,
    ]);
  }, 60_000);
});
