import { type Collection, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useTestMongo } from "@/test/use-test-mongo";
import { SessionWriter, type StepDoc } from "./writer";

describe("a step retried after a lost reply", () => {
  useTestMongo();

  it("is listed once among the session's recent steps", async () => {
    // Given a sessions collection that applies its first bulk write and then loses the reply
    const db = await getDb();
    const sessions = db.collection("sessions");
    await sessions.deleteMany({});
    let calls = 0;
    const flaky = new Proxy(sessions, {
      get(target, property) {
        if (property !== "bulkWrite") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: Parameters<Collection["bulkWrite"]>) => {
          const result = await target.bulkWrite(...args);
          if (++calls === 1) throw new Error("reply lost");
          return result;
        };
      },
    });
    const writer = new SessionWriter(flaky, db.collection("steps"), {
      flushMs: 0,
      maxOpsPerSecond: 1000,
      now: Date.now,
      log: () => {},
      retryMs: 10,
    });
    const step = (n: number): StepDoc => ({
      _id: new ObjectId(),
      machineId: "m1",
      sessionId: "s1",
      text: `step ${n}`,
      startedAt: new Date(1_700_000_000_000 + n * 1000),
      durationMs: 10,
      status: "ok",
    });
    const steps = [1, 2, 3, 4, 5].map(step);

    // When five steps are written, the reply is lost, and the writer retries
    writer.submit(
      {
        machineId: "m1",
        machineName: "Mac",
        sessionId: "s1",
        cwd: "/work",
        state: "waiting",
        startedAt: new Date(0),
      },
      steps,
    );
    await writer.flush();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writer.flush();
    writer.stop();

    // Then the session lists each of the five steps exactly once
    const stored = await sessions.findOne({ sessionId: "s1" });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(
      stored?.recentSteps.map((recent: { text: string }) => recent.text),
    ).toEqual(["step 1", "step 2", "step 3", "step 4", "step 5"]);
  }, 60_000);
});
