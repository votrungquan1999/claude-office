import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { pause, runHook } from "./run-hook";

describe("a closed session goes home", () => {
  const { setUpMac } = useMacHarness();

  it("records the end with a week's expiry, reopens on resume, and flags a session that never got a prompt; /clear sends the old one home and a new one arrives", async () => {
    // Given a Mac with three sessions
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    for (const sessionId of ["s1", "s2", "s3"]) {
      fake.addSession({ sessionId, cwd: `/work/${sessionId}` });
    }
    const send = (sessionId: string, event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        ...event,
      });
    const stored = async (sessionId: string) => {
      await agent.flush();
      return (await getDb())
        .collection("sessions")
        .findOne({ machineId: "machine-air", sessionId });
    };

    // When the first session gets a prompt and ends
    await send("s1", { hook_event_name: "SessionStart", source: "startup" });
    await send("s1", { hook_event_name: "UserPromptSubmit", prompt: "hi" });
    await send("s1", { hook_event_name: "SessionEnd", reason: "other" });
    const ended = await stored("s1");

    // Then it has gone home, stamped with an end time, expires in a week and had a prompt
    expect(ended?.state).toBe("wentHome");
    expect(ended?.endedAt).toBeInstanceOf(Date);
    const week = 7 * 86_400_000;
    expect(ended?.expireAt.getTime() - ended?.endedAt.getTime()).toBe(week);
    expect(ended?.hadPrompt).toBe(true);

    // When a kanban card appears for it, so the agent publishes the session again
    fake.writeKanban("s1", { cardId: "c1", summary: "Late card" });
    await pause(300);
    const republished = await stored("s1");

    // Then the end time is the one it first got, though the session was written again
    expect(republished?.state).toBe("wentHome");
    expect(republished?.endedAt).toEqual(ended?.endedAt);
    expect(republished?.changedAt.getTime()).toBeGreaterThan(
      ended?.changedAt.getTime(),
    );

    // When it is resumed
    await send("s1", { hook_event_name: "SessionStart", source: "resume" });
    const resumed = await stored("s1");

    // Then it is back, with no end time or expiry
    expect(resumed?.state).toBe("idle");
    expect(resumed?.endedAt).toBeUndefined();
    expect(resumed?.expireAt).toBeUndefined();
    expect(resumed?.hadPrompt).toBe(true);

    // When /clear ends it and a new session starts, and another session starts and ends without a prompt
    await send("s1", { hook_event_name: "SessionEnd", reason: "clear" });
    await send("s2", { hook_event_name: "SessionStart", source: "clear" });
    await send("s3", { hook_event_name: "SessionStart", source: "startup" });
    await send("s3", { hook_event_name: "SessionEnd", reason: "other" });

    // Then the old one is home, the new one is waiting, and the unprompted one is flagged
    expect((await stored("s1"))?.state).toBe("wentHome");
    expect((await stored("s2"))?.state).toBe("idle");
    expect((await stored("s3"))?.state).toBe("wentHome");
    expect((await stored("s3"))?.hadPrompt).toBe(false);
  }, 60_000);
});
