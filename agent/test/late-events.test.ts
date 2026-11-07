import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { pause, runHook, startHook } from "./run-hook";

describe("events that arrive late, twice or out of order", () => {
  const { setUpMac } = useMacHarness();

  it("does not move a session back to working when a tool start stamped before its Stop arrives after it", async () => {
    // Given a session whose turn has ended
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const home = fake.home;
    const send = (event: Record<string, unknown>) =>
      runHook(home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When a tool start stamped before the Stop is delivered only after the Stop was applied
    const slowPre = startHook(home, {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/work/app",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { description: "Long build" },
    });
    await pause(250);
    await send({ hook_event_name: "Stop" });
    await agent.flush();
    await slowPre.finish();
    await agent.flush();

    // Then the session still waits and shows no running step
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    expect(stored?.state).toBe("waiting");
    expect(stored?.runningSteps).toEqual([]);
  }, 60_000);

  it("closes a tool whose end arrives after later events were applied, so the room stops showing working", async () => {
    // Given a turn with tool t1 started
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const home = fake.home;
    const send = (event: Record<string, unknown>) =>
      runHook(home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { description: "Long build" },
    });

    // When t1's end is stamped first but delivered only after a later tool started and finished
    const slowPost = startHook(home, {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/work/app",
      tool_name: "Bash",
      tool_use_id: "t1",
    });
    await pause(250);
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t2",
    });
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_use_id: "t2",
    });
    await agent.flush();
    await slowPost.finish();
    await agent.flush();

    // Then no tool is left running and the session is thinking, not working
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    expect(stored?.state).toBe("thinking");
    expect(stored?.runningSteps).toEqual([]);
  }, 60_000);

  it("shows one API error step when the same failed turn is reported twice", async () => {
    // Given a session mid-turn
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When the turn's API failure is delivered twice
    await send({ hook_event_name: "StopFailure" });
    await send({ hook_event_name: "StopFailure" });
    await agent.flush();

    // Then the session lists a single API error step
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    expect(
      stored?.recentSteps.filter(
        (step: { text: string }) => step.text === "API error",
      ),
    ).toHaveLength(1);
  }, 60_000);
});
