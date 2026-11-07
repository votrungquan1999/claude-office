import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("running steps are closed as stopped when their session stops under them", () => {
  const { setUpMac } = useMacHarness();
  const processes = useLiveProcesses();

  it("closes the sibling tools when an interrupt ends one of them", async () => {
    // Given a session running two tools in parallel
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    for (const [id, command] of [
      ["t1", "Read"],
      ["t2", "Grep"],
    ]) {
      await send({
        hook_event_name: "PreToolUse",
        tool_name: command,
        tool_use_id: id,
        tool_input: {},
      });
    }

    // When the owner interrupts and only the first tool reports it
    await send({
      hook_event_name: "PostToolUseFailure",
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: {},
      is_interrupt: true,
    });
    await agent.flush();

    // Then both steps are listed as stopped and none keeps running
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    expect(stored?.runningSteps).toEqual([]);
    expect(
      stored?.recentSteps.map((step: { status: string }) => step.status),
    ).toEqual(["stopped", "stopped"]);
  }, 60_000);

  it("closes a running step as stopped when its session goes home because the process died", async () => {
    // Given a session whose tool is still running
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const claude = await processes.live();
    fake.addSession({
      sessionId: "s1",
      cwd: "/work/app",
      pid: claude.pid,
      procStart: claude.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { description: "Long build" },
    });

    await agent.flush();

    // When the process dies and the Mac checks its sessions
    await claude.kill();
    await agent.reconcile();
    await agent.flush();

    // Then the session is home and its step is listed as stopped, not running
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    expect(stored?.state).toBe("wentHome");
    expect(stored?.runningSteps).toEqual([]);
    expect(
      stored?.recentSteps.map((step: { text: string; status: string }) => [
        step.text,
        step.status,
      ]),
    ).toEqual([["Long build", "stopped"]]);
  }, 60_000);
});
