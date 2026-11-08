import { describe, expect, it } from "vitest";
import { hookEventSchema } from "@/shared/hook-events";
import { reduceEvent } from "../../hooks/claude-office-hook.mjs";

const SECRET = "rm -rf /secret-command";

describe("the hook's field allowlist", () => {
  it("drops command text, tool output and error text, and matches what the agent's schema accepts", () => {
    // Given raw payloads that carry sensitive fields beside the allowed ones
    const bash = {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/work",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { command: SECRET, description: "Clean the build folder" },
      tool_response: { stdout: SECRET },
      error: SECRET,
      message: SECRET,
      last_assistant_message: SECRET,
      permission_suggestions: [SECRET],
      duration_ms: 12,
    };
    const submit = {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "p".repeat(600),
    };
    const fetchPage = {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name: "WebFetch",
      tool_input: {
        url: "https://docs.example.com/a/b?token=abc",
        prompt: SECRET,
      },
    };
    const read = {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/Users/q/secret-dir/notes.md" },
    };

    // When the hook reduces them and the agent parses the result
    const reduced = [bash, fetchPage, read, submit].map((payload) =>
      reduceEvent(payload, 1000, {
        CLAUDE_CODE_BRIDGE_SESSION_ID: "session_x",
      }),
    );
    const parsed = reduced.map((event) => hookEventSchema.parse(event));

    // Then nothing sensitive survives, only the reduced input stays (a file step's folder goes to the local agent only), and both sides agree
    expect(JSON.stringify(reduced)).not.toContain(SECRET);
    expect(JSON.stringify(reduced)).not.toContain("token=abc");
    expect(reduced.map((event) => event.tool_input)).toEqual([
      { description: "Clean the build folder" },
      { domain: "docs.example.com" },
      { file_name: "notes.md", file_dir: "/Users/q/secret-dir" },
      undefined,
    ]);
    expect(reduced[3].prompt).toHaveLength(500);
    expect(reduced[0]).toMatchObject({
      hookTs: 1000,
      bridgeSessionId: "session_x",
    });
    expect(parsed).toEqual(reduced);
  });

  it("forwards only the tail of a Stop's last answer and its follow-up marker, and no answer text on other events", () => {
    // Given a Stop with a long answer, and a PostToolUse carrying the same field
    const answer = `${"x".repeat(1500)}Want me to push?`;
    const stop = {
      hook_event_name: "Stop",
      session_id: "s1",
      stop_hook_active: true,
      last_assistant_message: answer,
    };
    const post = {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      stop_hook_active: true,
      last_assistant_message: answer,
    };

    // When the hook reduces them and the agent parses the result
    const [reducedStop, reducedPost] = [stop, post].map((payload) =>
      reduceEvent(payload, 1000, {}),
    );

    // Then the Stop keeps the last 1000 characters and the marker, and the agent accepts it
    expect(reducedStop.stop_hook_active).toBe(true);
    expect(reducedStop.last_assistant_message).toBe(answer.slice(-1000));
    expect(String(reducedStop.last_assistant_message).endsWith("push?")).toBe(
      true,
    );
    expect(hookEventSchema.parse(reducedStop)).toEqual(reducedStop);

    // And other events carry neither field
    expect(reducedPost).not.toHaveProperty("last_assistant_message");
    expect(reducedPost).not.toHaveProperty("stop_hook_active");
  });

  it("forwards the folder of a notebook edit and of a relative file path, resolved against the session folder", () => {
    // Given a NotebookEdit and a Read with a relative path
    const notebook = {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/work",
      tool_name: "NotebookEdit",
      tool_input: {
        notebook_path: "/repos/ml/nb/a.ipynb",
        new_source: "SECRET",
      },
    };
    const relative = {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/work",
      tool_name: "Read",
      tool_input: { file_path: "docs/readme.md" },
    };

    // When the hook reduces them
    const [reducedNotebook, reducedRelative] = [notebook, relative].map((p) =>
      reduceEvent(p, 1000, {}),
    );

    // Then each carries its folder, and the notebook's source text is dropped
    expect(reducedNotebook.tool_input).toEqual({ file_dir: "/repos/ml/nb" });
    expect(reducedRelative.tool_input).toEqual({
      file_dir: "/work/docs",
      file_name: "readme.md",
    });
  });

  it("cuts a pasted block out of the prompt before the 500-character cut, so typed words survive, and forwards the paste's head separately", () => {
    // Given a 2000-character paste in the real tag shape, then typed words
    const paste = `\n\n<pasted_content id="d296">${"P".repeat(2000)}</pasted_content id="d296">`;
    const payload = {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: `${paste} fix the login redirect`,
    };

    // When the hook reduces it and the agent parses the result
    const reduced = reduceEvent(payload, 1000, {});
    const parsed = hookEventSchema.parse(reduced);

    // Then the prompt keeps the typed words and none of the paste, and the head is the first 500 paste characters
    expect(parsed.prompt).toContain("fix the login redirect");
    expect(parsed.prompt).not.toContain("PPPP");
    expect(parsed.prompt).toContain("<pasted_content/>");
    expect(parsed.paste_head).toBe("P".repeat(500));
  });

  it("keeps a paste with an inner paste tag of another id as one paste and takes the head from the first non-blank one", () => {
    // Given a blank paste, then a paste holding an inner tag, then typed words
    const prompt = `<pasted_content id="d1"> </pasted_content id="d1"><pasted_content id="d2">head <pasted_content id="in">x</pasted_content id="in"> tail</pasted_content id="d2"> fix it`;

    // When the hook reduces it
    const reduced = reduceEvent(
      { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt },
      1000,
      {},
    );

    // Then only the typed words remain beside placeholders, and the head is the second paste's start
    expect(reduced.prompt).toBe("<pasted_content/><pasted_content/> fix it");
    expect(reduced.paste_head).toBe(
      'head <pasted_content id="in">x</pasted_content id="in"> tail',
    );
  });
});
