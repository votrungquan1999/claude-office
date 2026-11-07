import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getOlderSteps } from "@/app/api/office/steps/route";
import { getDb } from "@/db/mongo";
import { stepsPageSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useMacHarness } from "./mac-harness";
import { pause, runHook, startHook } from "./run-hook";

describe("an employee shows its steps", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  it("lists the last 5 finished steps newest last with durations, shows a running one, and keeps every step for a week", async () => {
    // Given a session on a Mac
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    const tool = async (
      id: string,
      name: string,
      input: object,
      durationMs: number,
    ) => {
      await send({
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_use_id: id,
        tool_input: input,
      });
      await send({
        hook_event_name: "PostToolUse",
        tool_name: name,
        tool_use_id: id,
        tool_input: input,
        duration_ms: durationMs,
      });
    };
    const only = async () => {
      await agent.flush();
      const [session] = await officeSessions();
      return session;
    };
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When seven tools finish, with a command that must never show
    await tool("t1", "Read", { file_path: "/work/app/a.ts" }, 120);
    await tool("t2", "Edit", { file_path: "/work/app/b.ts" }, 80);
    await tool(
      "t3",
      "Bash",
      { command: "echo hi", description: "Run the tests" },
      4500,
    );
    await tool("t4", "Grep", { pattern: "TODO" }, 30);
    await tool("t5", "WebFetch", { url: "https://docs.example.com/x" }, 900);
    await tool("t6", "Write", { file_path: "/work/app/c.md" }, 15);
    await tool("t7", "Bash", { command: "ls" }, 40);

    // Then the office lists the last five, oldest of them first, with their run times
    const session = await only();
    expect(
      session?.recentSteps?.map((s) => [s.text, s.durationMs, s.status]),
    ).toEqual([
      ["Run the tests", 4500, "ok"],
      ["Search 'TODO'", 30, "ok"],
      ["docs.example.com", 900, "ok"],
      ["Write c.md", 15, "ok"],
      ["Bash", 40, "ok"],
    ]);

    // And the database holds all seven, each expiring in a week
    const stored = await (await getDb())
      .collection("steps")
      .find({ sessionId: "s1" })
      .toArray();
    expect(stored).toHaveLength(7);
    const week = 7 * 86_400_000;
    for (const step of stored) {
      expect(step.expireAt.getTime() - Date.now()).toBeGreaterThan(
        week - 60_000,
      );
      expect(step.expireAt.getTime() - Date.now()).toBeLessThanOrEqual(week);
    }

    // When a tool starts and has not finished
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t8",
      tool_input: { file_path: "/work/app/d.ts" },
    });

    // Then it shows as running, and is not yet in the finished list
    const running = await only();
    expect(running?.runningSteps?.map((s) => s.text)).toEqual(["Read d.ts"]);
    expect(running?.recentSteps).toHaveLength(5);
  }, 60_000);

  it("keeps the latest-started steps visible when parallel steps finish out of start order, and the older pages hold every other step once", async () => {
    // Given a session mid-turn, with no steps left over from other tests
    await (await getDb()).collection("steps").deleteMany({});
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const input = (name: string) => ({ file_path: `/work/app/${name}.ts` });

    // When seven steps start in order and finish in the opposite order
    for (const name of names) {
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: `t-${name}`,
        tool_input: input(name),
      });
    }
    for (const name of [...names].reverse()) {
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: `t-${name}`,
        tool_input: input(name),
        duration_ms: 10,
      });
    }
    await agent.flush();

    // Then the visible five are the five that started last, oldest first
    const [session] = await officeSessions();
    const recent = session?.recentSteps ?? [];
    expect(recent.map((s) => s.text)).toEqual([
      "Read c.ts",
      "Read d.ts",
      "Read e.ts",
      "Read f.ts",
      "Read g.ts",
    ]);

    // And "show more" holds the other two, so every step appears exactly once
    const ownerHeaders =
      (await sessionHeadersFor("owner@example.com")) ?? new Headers();
    const url = new URL("http://localhost:4710/api/office/steps");
    url.searchParams.set("machineId", "machine-air");
    url.searchParams.set("sessionId", "s1");
    url.searchParams.set("before", `${recent[0].startedAt},${recent[0].id}`);
    const page = stepsPageSchema.parse(
      await (
        await getOlderSteps(new NextRequest(url, { headers: ownerHeaders }))
      ).json(),
    );
    const seen = [...recent, ...page.steps].map((s) => s.text).sort();
    expect(seen).toEqual(names.map((n) => `Read ${n}.ts`));
  }, 60_000);

  it("adds no second step when a finish arrives after the turn already closed that step", async () => {
    // Given a session with a step left running when the turn ends
    await (await getDb()).collection("steps").deleteMany({});
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/work/app/a.ts" },
    });
    await send({ hook_event_name: "Stop" });

    // When that step's finish event arrives late
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/work/app/a.ts" },
      duration_ms: 10,
    });
    await agent.flush();

    // Then the step is listed once
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => s.text)).toEqual(["Read a.ts"]);
    const stored = await (await getDb())
      .collection("steps")
      .countDocuments({ sessionId: "s1" });
    expect(stored).toBe(1);
  }, 60_000);

  it("marks failed, interrupted and denied steps, and adds an API error step when a turn dies", async () => {
    // Given a session mid-turn
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    const start = (id: string, name: string, input: object) =>
      send({
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_use_id: id,
        tool_input: input,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When one tool fails (with error text that must never show), one is interrupted, one is denied, then the API fails
    await start("t1", "Bash", { command: "false" });
    await send({
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "t1",
      error: "exit 1 SECRET-ERROR",
      duration_ms: 50,
    });
    await start("t2", "Read", { file_path: "/work/app/a.ts" });
    await send({
      hook_event_name: "PostToolUseFailure",
      tool_name: "Read",
      tool_use_id: "t2",
      is_interrupt: true,
      duration_ms: 70,
    });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "again" });
    await start("t3", "Edit", { file_path: "/work/app/b.ts" });
    await send({
      hook_event_name: "PermissionDenied",
      tool_name: "Edit",
      tool_use_id: "t3",
    });
    await send({ hook_event_name: "StopFailure" });
    await agent.flush();

    // Then each is listed with how it ended
    const [session] = await officeSessions();
    expect(
      session?.recentSteps?.map((s) => [s.text, s.status, s.durationMs]),
    ).toEqual([
      ["Bash", "failed", 50],
      ["Read a.ts", "stopped", 70],
      ["Edit b.ts", "denied", expect.any(Number)],
      ["API error", "failed", undefined],
    ]);
    expect(JSON.stringify(session)).not.toContain("SECRET-ERROR");
  }, 60_000);

  it("ignores subagent tools, tolerates a finish that arrives before its start, times a step by timestamps when no duration is given, and closes a step left running when the turn ends", async () => {
    // Given a session mid-turn
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When a subagent's tool runs, a Post is delivered before its Pre, a step has no duration_ms, and a step is still running at Stop
    for (const event of ["PreToolUse", "PostToolUse"]) {
      await send({
        hook_event_name: event,
        tool_name: "Read",
        tool_use_id: "sub1",
        agent_id: "a1",
        tool_input: { file_path: "/work/app/hidden.ts" },
      });
    }
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Grep",
      tool_use_id: "p1",
      tool_input: { pattern: "late" },
      duration_ms: 200,
    });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_use_id: "p1",
      tool_input: { pattern: "late" },
    });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "b1",
      tool_input: { description: "Slow build" },
    });
    await pause(300);
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "b1",
    });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_use_id: "w1",
      tool_input: { file_path: "/work/app/out.md" },
    });
    await send({ hook_event_name: "Stop" });
    await agent.flush();

    // Then the subagent adds nothing, the early Post is one step, the timestamps give the duration, and the dangling step is stopped with no duration
    const [session] = await officeSessions();
    const steps = session?.recentSteps ?? [];
    expect(steps.map((s) => [s.text, s.status])).toEqual([
      ["Search 'late'", "ok"],
      ["Slow build", "ok"],
      ["Write out.md", "stopped"],
    ]);
    expect(steps[0].durationMs).toBe(200);
    expect(steps[1].durationMs).toBeGreaterThanOrEqual(250);
    expect(steps[1].durationMs).toBeLessThan(3000);
    expect(steps[2].durationMs).toBeUndefined();
    expect(session?.runningSteps).toBeUndefined();
  }, 60_000);

  it("shows the in-progress to-do line instead of adding a step, and clears it when none is in progress", async () => {
    // Given a session mid-turn
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    const writeTodos = async (id: string, todos: object[]) => {
      for (const event of ["PreToolUse", "PostToolUse"]) {
        await send({
          hook_event_name: event,
          tool_name: "TodoWrite",
          tool_use_id: id,
          tool_input: { todos },
        });
      }
      await agent.flush();
      return (await officeSessions())[0];
    };
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When the to-do list has one item in progress
    const during = await writeTodos("td1", [
      { content: "Plan", status: "completed", activeForm: "Planning" },
      {
        content: "Fix login",
        status: "in_progress",
        activeForm: "Fixing login",
      },
      { content: "Test", status: "pending", activeForm: "Testing" },
    ]);

    // Then the desk shows that line and no step was added
    expect(during?.currentTodo).toBe("Fixing login");
    expect(during?.recentSteps).toBeUndefined();

    // When every item is done
    const after = await writeTodos("td2", [
      { content: "Fix login", status: "completed", activeForm: "Fixing login" },
    ]);

    // Then the line is gone
    expect(after?.currentTodo).toBeUndefined();
  }, 60_000);

  it("marks a command or agent started in the background", async () => {
    // Given a session mid-turn
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When a Bash command and an agent start in the background, and one runs normally
    const run = async (id: string, name: string, input: object) => {
      for (const event of ["PreToolUse", "PostToolUse"]) {
        await send({
          hook_event_name: event,
          tool_name: name,
          tool_use_id: id,
          tool_input: input,
          duration_ms: 10,
        });
      }
    };
    await run("b1", "Bash", {
      command: "npm run dev",
      description: "Start the server",
      run_in_background: true,
    });
    await run("a1", "Agent", {
      description: "Scan the repo",
      run_in_background: true,
    });
    await run("b2", "Bash", {
      command: "ls",
      description: "List files",
      run_in_background: false,
    });
    await agent.flush();

    // Then only the background ones say so
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => s.text)).toEqual([
      "Start the server (started in background)",
      "Agent: Scan the repo (started in background)",
      "List files",
    ]);
  }, 60_000);

  it("never shows a negative run time when the end of a tool is stamped before its start", async () => {
    // Given a session and no run time reported by the tool
    await (await getDb()).collection("steps").deleteMany({});
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    const tool = {
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/work/app/a.ts" },
    };
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When the end hook boots first but is delivered after the start hook that booted later
    const slowPost = startHook(fake.home, {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/work/app",
      ...tool,
    });
    await pause(250);
    await send({ hook_event_name: "PreToolUse", ...tool });
    await agent.flush();
    await slowPost.finish();
    await agent.flush();

    // Then the step's run time is zero, not negative
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((s) => [s.text, s.durationMs])).toEqual([
      ["Read a.ts", 0],
    ]);
  }, 60_000);
});
