import { describe, expect, it } from "vitest";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("an employee moves to the room matching its session", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  it("follows a turn: idle, thinking, working, needs permission, thinking, idle", async () => {
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

    // Then it was idle, thinking, working, needs permission, thinking, idle
    expect(states).toEqual([
      "idle",
      "thinking",
      "working",
      "needsPermission",
      "thinking",
      "idle",
    ]);
  });

  describe("when a turn ends", () => {
    /** One interactive session on a Mac; `send` runs an event through the real hook and returns the state shown. */
    async function startSession() {
      const { fake, agent } = await setUpMac(
        "machine-air",
        "Quan's MacBook Air",
      );
      fake.addSession({ sessionId: "s1", cwd: "/work/app" });
      async function send(event: Record<string, unknown>): Promise<string> {
        await runHook(fake.home, {
          session_id: "s1",
          cwd: "/work/app",
          ...event,
        });
        await agent.flush();
        return (await officeSessions())[0]?.state;
      }
      await send({ hook_event_name: "SessionStart", source: "startup" });
      await send({ hook_event_name: "UserPromptSubmit", prompt: "fix it" });
      return { send };
    }

    it("moves to Waiting for you when the last answer asks the owner, and to Idle when it does not", async () => {
      // Given a session in the middle of a turn
      const { send } = await startSession();

      // When the turn ends with a question
      const asked = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "I fixed it. Want me to push?",
      });

      // Then it waits for the owner
      expect(asked).toBe("waitingForYou");

      // When the next turn ends with a plain summary
      await send({ hook_event_name: "UserPromptSubmit", prompt: "yes" });
      // A follow-up Stop keeps an earlier question, so idle here proves the prompt reset it
      const plain = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Pushed the branch.",
      });

      // Then it is idle
      expect(plain).toBe("idle");
    });

    it("moves to Waiting for you when the question follows a code block that the hook's text cut in the middle", async () => {
      // Given a session whose last answer is a long code block followed by a question
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}\`\`\`\nWant me to push?`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it waits for the owner
      expect(state).toBe("waitingForYou");
    });

    it("moves to Waiting for you when a code block opened before the cut closes inside the kept text and another block opens after the question", async () => {
      // Given a long code block, then a question, then a second block left open at the end
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}\`\`\`\nWant me to push?\n\`\`\`sh\nnpm test`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it waits for the owner
      expect(state).toBe("waitingForYou");
    });

    it("moves to Idle when the answer ends inside a code block that the hook's text cut, even if the block's last line reads like a question", async () => {
      // Given a session whose last answer is one long unclosed code block ending in a question-like line
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}// Want me to push?`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it is idle: code is not a question
      expect(state).toBe("idle");
    });

    it("keeps Waiting for you when a Stop-hook follow-up, with or without tools, ends after the question", async () => {
      // Given a session whose turn ended with a question
      const { send } = await startSession();
      await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "Which branch should I use?",
      });

      // When a Stop hook makes it run a follow-up that ends with a plain answer
      const followUp = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "No spec update is needed.",
      });

      // Then it still waits for the owner
      expect(followUp).toBe("waitingForYou");

      // When the follow-up runs a tool before its plain answer
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: "r1",
      });
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: "r1",
      });
      const afterTool = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Nothing to update in the spec yet.",
      });

      // Then it still waits for the owner
      expect(afterTool).toBe("waitingForYou");
    });

    it("moves to Idle when the Stop carries no answer text, as an old hook sends", async () => {
      // Given a session in the middle of a turn
      const { send } = await startSession();

      // When the turn ends with a Stop that has no text fields
      const state = await send({ hook_event_name: "Stop" });

      // Then it is idle, never a false badge
      expect(state).toBe("idle");
    });
  });
});
