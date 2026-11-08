import { BSON } from "mongodb";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { readAgentFile, writeAgentFile } from "../config";
import { startListener } from "../server";
import { makeFakeHome } from "./fake-home";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

/** A plain token, and one with a shell variable, a newline and quotes (the JSON-escaped form differs from the raw one). */
const SENTINELS = ["SENTINEL_PLAIN_7f3a", '$SECRET_7f3a\n"x"'];

/**
 * Every place a sentinel could hide: raw, and as it looks inside JSON text.
 * @param sentinel - The made-up command text.
 * @returns The forms to search for.
 */
function formsOf(sentinel: string): string[] {
  return [sentinel, JSON.stringify(sentinel).slice(1, -1)];
}

/**
 * One of every kind of event that can carry command text, each carrying it.
 * @param sentinel - The made-up command text.
 * @returns Hook payloads for one session.
 */
function hostileEvents(sentinel: string): Array<Record<string, unknown>> {
  const input = { command: sentinel, description: "Run the tests" };
  return [
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "a",
      tool_input: input,
    },
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "a",
      tool_input: input,
      tool_response: { stdout: sentinel },
      duration_ms: 5,
    },
    {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "b",
      tool_input: input,
      error: sentinel,
    },
    {
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: input,
      permission_suggestions: [sentinel],
    },
    {
      hook_event_name: "PermissionDenied",
      tool_name: "Bash",
      tool_use_id: "c",
      tool_input: input,
      reason: sentinel,
    },
    {
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: sentinel,
    },
    {
      hook_event_name: "PreToolUse",
      tool_name: "Monitor",
      tool_use_id: "d",
      tool_input: { command: sentinel },
    },
    { hook_event_name: "Stop", last_assistant_message: sentinel },
  ];
}

describe("shell command text never leaves the Mac", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  /** Every collection of the test database as one searchable text, keys and BSON types included. */
  async function databaseDump(): Promise<string> {
    const db = await getDb();
    const parts: string[] = [];
    for (const { name } of await db.listCollections().toArray()) {
      const docs = await db.collection(name).find({}).toArray();
      parts.push(name, BSON.EJSON.stringify(docs), JSON.stringify(docs));
    }
    return parts.join("\n");
  }

  /** Sets up a Mac with one session that is mid-turn. */
  async function midTurn() {
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    return { send, agent, fake };
  }

  it("shows a Bash step as its description, or just 'Bash' without one", async () => {
    // Given a session mid-turn
    const { send, agent } = await midTurn();

    for (const sentinel of SENTINELS) {
      // When Bash runs with a command that must stay on the Mac, with and without a description
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: `d-${sentinel.length}`,
        tool_input: { command: sentinel, description: "Run the tests" },
      });
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: `n-${sentinel.length}`,
        tool_input: { command: sentinel },
      });
    }
    await agent.flush();

    // Then the office shows the description, or "Bash", while those steps run
    const [session] = await officeSessions();
    expect(session?.runningSteps?.map((s) => s.text)).toEqual([
      "Run the tests",
      "Bash",
      "Run the tests",
      "Bash",
    ]);
  }, 60_000);

  it("keeps the command out of tool output and error text, and finished Bash steps keep only their description", async () => {
    // Given a session mid-turn
    const { send, agent } = await midTurn();

    for (const [i, sentinel] of SENTINELS.entries()) {
      // When a command's output and a failure's error text both echo the command
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: `ok-${i}`,
        tool_input: { command: sentinel, description: "Run the tests" },
      });
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: `ok-${i}`,
        tool_input: { command: sentinel, description: "Run the tests" },
        tool_response: { stdout: sentinel, stderr: sentinel },
        duration_ms: 20,
      });
      await send({
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: `bad-${i}`,
        tool_input: { command: sentinel },
        error: `failed: ${sentinel}`,
        duration_ms: 20,
      });
    }
    await agent.flush();

    // Then the steps read "Run the tests" and "Bash", and no sentinel is anywhere in the database
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => [s.text, s.status])).toEqual([
      ["Run the tests", "ok"],
      ["Bash", "failed"],
      ["Run the tests", "ok"],
      ["Bash", "failed"],
    ]);
    const dump = await databaseDump();
    for (const form of SENTINELS.flatMap(formsOf)) {
      expect(dump).not.toContain(form);
    }
  }, 60_000);

  it("keeps the command out of permission dialogs and notifications", async () => {
    // Given a session mid-turn
    const { send, agent } = await midTurn();

    for (const [i, sentinel] of SENTINELS.entries()) {
      // When a dialog asks about the command, it is denied, and a notification quotes it
      await send({
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: sentinel, description: "Wipe the cache" },
        permission_suggestions: [{ type: "addRules", rules: [sentinel] }],
      });
      await send({
        hook_event_name: "PermissionDenied",
        tool_name: "Bash",
        tool_use_id: `deny-${i}`,
        tool_input: { command: sentinel },
        permission_suggestions: [sentinel],
        reason: sentinel,
      });
      await send({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: `Claude needs your permission to run ${sentinel}`,
      });
    }
    await agent.flush();

    // Then the office still shows the dialog and a denied step, and no sentinel is in the database
    const [session] = await officeSessions();
    expect(session?.state).toBe("needsPermission");
    expect(session?.recentSteps?.map((s) => [s.text, s.status])).toEqual([
      ["Bash", "denied"],
      ["Bash", "denied"],
    ]);
    const dump = await databaseDump();
    for (const form of SENTINELS.flatMap(formsOf)) {
      expect(dump).not.toContain(form);
    }
  }, 60_000);

  it("keeps the command out of Monitor, unknown and MCP tools, which show only the tool name", async () => {
    // Given a session mid-turn
    const { send, agent } = await midTurn();

    for (const [i, sentinel] of SENTINELS.entries()) {
      // When tools with no step rule carry a command-like input
      for (const tool of ["Monitor", "SomeFutureTool", "mcp__shell__exec"]) {
        const id = `${tool}-${i}`;
        const input = { command: sentinel, script: sentinel };
        await send({
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_use_id: id,
          tool_input: input,
        });
        await send({
          hook_event_name: "PostToolUse",
          tool_name: tool,
          tool_use_id: id,
          tool_input: input,
          duration_ms: 5,
        });
      }
    }
    await agent.flush();

    // Then each shows its tool name only, and no sentinel is in the database
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => s.text)).toEqual([
      "SomeFutureTool",
      "mcp__shell__exec",
      "Monitor",
      "SomeFutureTool",
      "mcp__shell__exec",
    ]);
    const dump = await databaseDump();
    for (const form of SENTINELS.flatMap(formsOf)) {
      expect(dump).not.toContain(form);
    }
  }, 60_000);

  it("sends the agent no command text and leaves none anywhere in the database, whichever event carried it", async () => {
    // Given a session mid-turn, and a second Mac whose "agent" only records what it receives
    const { send, agent } = await midTurn();
    const received: unknown[] = [];
    const listener = await startListener("tok", (body) => received.push(body));
    const spy = makeFakeHome("machine-spy");
    writeAgentFile(spy.home, {
      pid: process.pid,
      port: listener.port,
      token: "tok",
    });

    try {
      // When every kind of event, carrying each sentinel, goes through the real hook to both
      for (const sentinel of SENTINELS) {
        for (const event of hostileEvents(sentinel)) {
          await send(event);
          await runHook(spy.home, {
            session_id: "s1",
            cwd: "/work/app",
            ...event,
          });
        }
      }
      await agent.flush();

      // Then the recorded bodies are not empty and hold no sentinel
      expect(received.length).toBe(
        SENTINELS.length * hostileEvents("x").length,
      );
      // Only a Stop forwards text (the turn's answer tail); strip that one field before the check
      const wire = received
        .map((body) => {
          const { last_assistant_message: _answer, ...rest } = body as Record<
            string,
            unknown
          >;
          return JSON.stringify(rest);
        })
        .join("\n");
      expect(wire).toContain("Run the tests");
      for (const form of SENTINELS.flatMap(formsOf)) {
        expect(wire).not.toContain(form);
      }

      // And the whole database holds no sentinel, in any collection, key or type
      const [session] = await officeSessions();
      expect(session?.cwd).toBe("/work/app");
      const dump = await databaseDump();
      for (const form of SENTINELS.flatMap(formsOf)) {
        expect(dump).not.toContain(form);
      }
    } finally {
      await listener.close();
      spy.remove();
    }
  }, 120_000);

  it("never stores the folder a file step ran in, which the agent only uses to find the repo", async () => {
    // Given a session mid-turn
    const { send, agent } = await midTurn();
    const folder = "SENTINEL_FOLDER_7f3a";

    // When it edits a file inside a folder with that name
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "f1",
      tool_input: { file_path: `/work/app/${folder}/a.ts` },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the step is stored by its file name and the folder is in no collection
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => s.text)).toEqual(["Edit a.ts"]);
    expect(await databaseDump()).not.toContain(folder);
  }, 60_000);

  it("keeps command text out of the database even when an event skips the hook and goes straight to the agent", async () => {
    // Given a session mid-turn and the agent's address from its file
    const { agent, fake } = await midTurn();
    const file = readAgentFile(fake.home);
    if (!file) throw new Error("The fake Mac has no agent file.");

    // When every hostile payload is posted raw to the agent's loopback port
    for (const sentinel of SENTINELS) {
      for (const event of hostileEvents(sentinel)) {
        const response = await fetch(`http://127.0.0.1:${file.port}/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${file.token}`,
          },
          body: JSON.stringify({
            session_id: "s1",
            cwd: "/work/app",
            hookTs: Date.now(),
            ...event,
          }),
        });
        expect(response.status).toBe(204);
      }
    }
    await agent.flush();

    // Then the session is still there and no sentinel is in any collection
    const [session] = await officeSessions();
    expect(session?.cwd).toBe("/work/app");
    const dump = await databaseDump();
    for (const form of SENTINELS.flatMap(formsOf)) {
      expect(dump).not.toContain(form);
    }
  }, 60_000);
});
