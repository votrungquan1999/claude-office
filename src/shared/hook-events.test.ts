import { describe, expect, it } from "vitest";
import { hookEventSchema } from "./hook-events";

describe("hook event schema", () => {
  it("drops shell command text from tool_input while keeping the keys step text needs", () => {
    // Given an event sent straight to the agent with a command beside the description
    const sent = {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      hookTs: 1,
      tool_name: "Bash",
      tool_input: { command: "SENTINEL_PLAIN_7f3a", description: "Run tests" },
    };

    // When the agent parses it
    const parsed = hookEventSchema.parse(sent);

    // Then only the description survives, so no command text can be stored or served
    expect(parsed.tool_input).toEqual({ description: "Run tests" });
    expect(JSON.stringify(parsed)).not.toContain("SENTINEL_PLAIN_7f3a");
  });
});
