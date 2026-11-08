import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a session whose process is gone goes home", () => {
  const { setUpMac } = useMacHarness();
  const processes = useLiveProcesses();

  it("sends home a session whose process died or whose pid now belongs to another process, and keeps one whose process is alive", async () => {
    // Given a Mac with three running sessions the hooks announced
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const [died, alive] = [await processes.live(), await processes.live()];
    fake.addSession({
      sessionId: "died",
      cwd: "/work/died",
      pid: died.pid,
      procStart: died.procStart,
    });
    fake.addSession({
      sessionId: "alive",
      cwd: "/work/alive",
      pid: alive.pid,
      procStart: alive.procStart,
    });
    // The third session's pid is the test's own, but the registry remembers another start time
    fake.addSession({
      sessionId: "reused",
      cwd: "/work/reused",
      pid: process.pid,
      procStart: "Mon Jan  1 00:00:00 2001",
    });
    for (const sessionId of ["died", "alive", "reused"]) {
      await runHook(fake.home, {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        source: "startup",
      });
    }
    await agent.flush();

    // When one process dies and the Mac checks its sessions
    await died.kill();
    await agent.reconcile();
    await agent.flush();

    // Then the dead and the reused-pid sessions have gone home and the live one has not
    const sessions = (await getDb()).collection("sessions");
    const state = async (sessionId: string) =>
      (await sessions.findOne({ sessionId }))?.state;
    expect(await state("died")).toBe("wentHome");
    expect(await state("reused")).toBe("wentHome");
    expect(await state("alive")).toBe("idle");
    expect(
      (await sessions.findOne({ sessionId: "died" }))?.endedAt,
    ).toBeInstanceOf(Date);
  }, 60_000);

  it("returns an interrupted session to waiting and follows a fresher registry status, but never lets an older or weaker one override the hooks", async () => {
    // Given a Mac with four sessions the hooks last saw mid-turn or mid-tool
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const ids = ["interrupted", "stale", "busy", "asks"];
    for (const sessionId of ids) {
      const process_ = await processes.live();
      fake.addSession({
        sessionId,
        cwd: `/work/${sessionId}`,
        pid: process_.pid,
        procStart: process_.procStart,
      });
      const send = (event: Record<string, unknown>) =>
        runHook(fake.home, {
          session_id: sessionId,
          cwd: `/work/${sessionId}`,
          ...event,
        });
      await send({ hook_event_name: "SessionStart", source: "startup" });
      await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
      if (sessionId === "busy") {
        await send({
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_use_id: "t1",
        });
      }
    }
    await agent.flush();
    const sessions = (await getDb()).collection("sessions");
    const state = async (sessionId: string) => {
      await agent.flush();
      return (await sessions.findOne({ sessionId }))?.state;
    };
    expect(await state("interrupted")).toBe("thinking");
    expect(await state("busy")).toBe("working");

    // When the registry, written after the last hook event, says idle, busy and waiting
    const later = Date.now() + 60_000;
    fake.updateSession("interrupted", {
      status: "idle",
      statusUpdatedAt: later,
    });
    fake.updateSession("busy", { status: "busy", statusUpdatedAt: later });
    fake.updateSession("asks", { status: "waiting", statusUpdatedAt: later });
    // And an idle status written before the last hook event
    fake.updateSession("stale", {
      status: "idle",
      statusUpdatedAt: 1_700_000_000_000,
    });
    await agent.reconcile();

    // Then the interrupted one is idle, the one asking needs permission, and the others keep what the hooks said
    expect(await state("interrupted")).toBe("idle");
    expect(await state("asks")).toBe("needsPermission");
    expect(await state("busy")).toBe("working");
    expect(await state("stale")).toBe("thinking");
  }, 60_000);
  it("shows a session whose registry entry only appeared after its hooks, on the next periodic check", async () => {
    // Given a session whose hooks arrived before Claude Code listed it in the registry, so it is held back
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "late",
      cwd: "/work/late",
      source: "startup",
    });
    await agent.flush();
    const sessions = (await getDb()).collection("sessions");
    expect(await sessions.findOne({ sessionId: "late" })).toBeNull();

    // When the registry lists it and only the periodic check runs
    const live = await processes.live();
    fake.addSession({
      sessionId: "late",
      cwd: "/work/late",
      pid: live.pid,
      procStart: live.procStart,
    });
    await agent.reconcile();

    // Then it appears without waiting for another hook event
    await vi.waitFor(
      async () => {
        expect(await sessions.findOne({ sessionId: "late" })).not.toBeNull();
      },
      { timeout: 5000 },
    );
  }, 60_000);

  it("sends home a session that /clear replaced, when another registry entry took over its process", async () => {
    // Given a running session
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const live = await processes.live();
    fake.addSession({
      sessionId: "before-clear",
      cwd: "/work/clear",
      pid: live.pid,
      procStart: live.procStart,
    });
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "before-clear",
      cwd: "/work/clear",
      source: "startup",
    });
    await agent.flush();

    // When /clear moves the same process to a new session id and the SessionEnd hook never arrives
    fake.removeSession("before-clear");
    fake.addSession({
      sessionId: "after-clear",
      cwd: "/work/clear",
      pid: live.pid,
      procStart: live.procStart,
    });
    await agent.reconcile();
    await agent.flush();

    // Then the old session has gone home although its process is still running
    const sessions = (await getDb()).collection("sessions");
    expect((await sessions.findOne({ sessionId: "before-clear" }))?.state).toBe(
      "wentHome",
    );
  }, 60_000);
  it("keeps a live session whose registry start time is written in another locale", async () => {
    // Given a running session whose registry start time is a French date that never matches ps output
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const live = await processes.live();
    fake.addSession({
      sessionId: "french",
      cwd: "/work/french",
      pid: live.pid,
      procStart: "dim. 1 nov. 08:00:00 2026",
    });
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "french",
      cwd: "/work/french",
      source: "startup",
    });
    await agent.flush();

    // When the Mac checks its sessions
    await agent.reconcile();
    await agent.flush();

    // Then the session is still in the office, since its pid is alive
    const sessions = (await getDb()).collection("sessions");
    expect((await sessions.findOne({ sessionId: "french" }))?.state).toBe(
      "idle",
    );
  }, 60_000);
});
