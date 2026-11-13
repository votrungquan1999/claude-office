import { describe, expect, it } from "vitest";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a background sub-agent keeps the desk working after the turn ended", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  /** One interactive session whose turn has ended with `lastMessage`; `send` runs an event through the real hook. */
  async function endedTurn(lastMessage: string) {
    const { fake, agent } = await setUpMac("machine-air", "Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    async function send(event: Record<string, unknown>) {
      await runHook(fake.home, {
        session_id: "s1",
        cwd: "/work/app",
        ...event,
      });
      await agent.flush();
      return (await officeSessions())[0]?.state;
    }
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "Stop",
      last_assistant_message: lastMessage,
    });
    return { send };
  }

  const sub = { agent_id: "sub1", agent_type: "general-purpose" };

  it("shows Working while the sub-agent runs and returns to the state the turn ended in when it stops", async () => {
    // Given a turn that ended with a result to look at
    const { send } = await endedTurn("Started it in the background.");

    // When a background sub-agent runs a tool
    const working = await send({
      ...sub,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
    });

    // Then the desk is working
    expect(working).toBe("working");

    // When the tool finishes the sub-agent is still alive
    const between = await send({
      ...sub,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
    });

    // Then the desk keeps working
    expect(between).toBe("working");

    // When the sub-agent stops
    const done = await send({ ...sub, hook_event_name: "SubagentStop" });

    // Then the desk is back in Review
    expect(done).toBe("review");
  });

  it("ignores a stray event of a sub-agent that already stopped", async () => {
    // Given a turn that ended in Review and a sub-agent that ran and stopped
    const { send } = await endedTurn("Started it in the background.");
    await send({
      ...sub,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
    });
    await send({ ...sub, hook_event_name: "SubagentStop" });

    // When a late event of that sub-agent arrives
    const state = await send({
      ...sub,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t2",
    });

    // Then the desk stays in Review
    expect(state).toBe("review");
  });

  it("returns to Waiting for you when the turn asked the owner something", async () => {
    // Given a turn that ended with a question
    const { send } = await endedTurn("Want me to push?");

    // When a sub-agent starts and then stops
    const working = await send({ ...sub, hook_event_name: "SubagentStart" });
    const done = await send({ ...sub, hook_event_name: "SubagentStop" });

    // Then the desk worked, then waits for the owner again
    expect([working, done]).toEqual(["working", "waitingForYou"]);
  });

  it("goes back to thinking at a new prompt and does not let a sub-agent that never reported its stop keep the desk working after the next turn ends", async () => {
    // Given a sub-agent running after the turn ended
    const { send } = await endedTurn("Started it in the background.");
    await send({ ...sub, hook_event_name: "SubagentStart" });

    // When the owner sends a new prompt, then that turn ends
    const thinking = await send({
      hook_event_name: "UserPromptSubmit",
      prompt: "next",
    });
    const ended = await send({
      hook_event_name: "Stop",
      last_assistant_message: "Done.",
    });

    // Then the prompt reset the desk to thinking and the new turn ended in Review
    expect([thinking, ended]).toEqual(["thinking", "review"]);
  });
});
