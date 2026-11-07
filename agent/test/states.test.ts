import { describe, expect, it } from "vitest";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("an employee moves to the room matching its session", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  it("follows a turn: waiting, thinking, working, needs permission, thinking, waiting", async () => {
    // Given a Mac with one interactive session
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });

    /** Sends one event through the real hook and returns the state the office shows. */
    async function send(event: Record<string, unknown>): Promise<string> {
      await runHook(fake.home, {
        session_id: "s1",
        cwd: "/work/app",
        ...event,
      });
      await agent.flush();
      return (await officeSessions())[0]?.state;
    }

    // When the session goes through one turn, the office shows the room after every event
    const states = [
      await send({ hook_event_name: "SessionStart", source: "startup" }),
      await send({ hook_event_name: "UserPromptSubmit", prompt: "fix it" }),
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "b1",
      }),
      await send({ hook_event_name: "PermissionRequest", tool_name: "Bash" }),
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "b1",
      }),
      await send({ hook_event_name: "Stop" }),
    ];

    // Then it was waiting, thinking, working, needs permission, thinking, waiting
    expect(states).toEqual([
      "waiting",
      "thinking",
      "working",
      "needsPermission",
      "thinking",
      "waiting",
    ]);
  });
});
