import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a session whose process is gone goes home", () => {
  const { setUpMac, officeSessions } = useMacHarness();
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
  it("keeps Waiting for you when Claude Code's registry says idle after the turn ended with a question", async () => {
    // Given a Mac with a running session whose turn ended with a question
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const process_ = await processes.live();
    fake.addSession({
      sessionId: "asked",
      cwd: "/work/asked",
      pid: process_.pid,
      procStart: process_.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: "asked",
        cwd: "/work/asked",
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Should I go ahead and merge it?",
    });
    await agent.flush();

    // When the registry, written after the Stop, says idle and the Mac checks its sessions
    fake.updateSession("asked", {
      status: "idle",
      statusUpdatedAt: Date.now() + 60_000,
    });
    await agent.reconcile();
    await agent.flush();

    // Then the session still waits for the owner
    const stored = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "asked" });
    expect(stored?.state).toBe("waitingForYou");
  }, 60_000);

  it("decides Waiting for you from the transcript when a Stop hook was missed and the registry says idle", async () => {
    // Given a running session mid-turn whose Stop never arrived, and a transcript ending in a question
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const process_ = await processes.live();
    fake.addSession({
      sessionId: "missed",
      cwd: "/work/missed",
      pid: process_.pid,
      procStart: process_.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: "missed",
        cwd: "/work/missed",
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await agent.flush();
    fake.addTranscript("missed", [
      { type: "user", message: { content: "go" } },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Should I merge it?" }],
        },
      },
    ]);

    // When the registry says idle and the Mac checks its sessions
    fake.updateSession("missed", {
      status: "idle",
      statusUpdatedAt: Date.now() + 60_000,
    });
    await agent.reconcile();
    await agent.flush();

    // Then the ask rule applies to the transcript's last answer
    expect((await officeSessions())[0]?.state).toBe("waitingForYou");
  }, 60_000);

  it("ends Working on the registry's idle even when a state-neutral idle prompt notification arrived after it", async () => {
    // Given a session mid-turn whose Stop was missed, and a registry idle stamped a moment after the last real event
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const process_ = await processes.live();
    fake.addSession({
      sessionId: "neutral",
      cwd: "/work/neutral",
      pid: process_.pid,
      procStart: process_.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: "neutral",
        cwd: "/work/neutral",
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    const idleAt = Date.now() + 150;

    // When the idle prompt notification arrives after that stamp, then the registry check runs
    await new Promise((resolve) => setTimeout(resolve, 400));
    await send({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
    });
    await agent.flush();
    fake.updateSession("neutral", { status: "idle", statusUpdatedAt: idleAt });
    await agent.reconcile();
    await agent.flush();

    // Then the session is idle, not Working forever
    expect((await officeSessions())[0]?.state).toBe("idle");
  }, 60_000);

  it("drops a permission dialog the registry reported once the registry says idle, on a turn that did not ask", async () => {
    // Given a Mac with a running session whose turn ended with a plain answer
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const process_ = await processes.live();
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: process_.pid,
      procStart: process_.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: "plain",
        cwd: "/work/plain",
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Merged.",
    });
    await agent.flush();
    const stored = async () =>
      (
        await (
          await getDb()
        )
          .collection("sessions")
          .findOne({ sessionId: "plain" })
      )?.state;

    // When the registry reports a permission dialog, then idle again, with no hook in between
    fake.updateSession("plain", {
      status: "waiting",
      statusUpdatedAt: Date.now() + 60_000,
    });
    await agent.reconcile();
    await agent.flush();
    expect(await stored()).toBe("needsPermission");
    fake.updateSession("plain", {
      status: "idle",
      statusUpdatedAt: Date.now() + 120_000,
    });
    await agent.reconcile();
    await agent.flush();

    // Then the session is idle, not stuck on Needs permission
    expect(await stored()).toBe("idle");
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

  it("counts a session as running while any registry entry for it is live, whichever file the registry lists first", async () => {
    // Given one live process and two stale entries of the same session id, one listed before it and one after
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const ids = ["stale-first", "stale-last"];
    for (const sessionId of ids) {
      const live = await processes.live();
      // The registry lists files in name order, so the stale pid is spelled to sort before or after the live one
      const stalePid =
        sessionId === "stale-first"
          ? Number(`1${"0".repeat(String(live.pid).length + 6)}`)
          : Number(`${live.pid}0000`);
      fake.addSession({
        sessionId,
        cwd: `/work/${sessionId}`,
        pid: stalePid,
      });
      fake.addSession({
        sessionId,
        cwd: `/work/${sessionId}`,
        pid: live.pid,
        procStart: live.procStart,
        bridgeSessionId: `bridge-${sessionId}`,
      });
      await runHook(fake.home, {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        source: "startup",
      });
    }
    await agent.flush();

    // When the Mac checks its sessions
    await agent.reconcile();
    await agent.flush();

    // Then both stay at their desks, linked through the live entry
    const desks = await officeSessions();
    expect(
      desks
        .map((d) => [d.sessionId, d.state, d.bridgeSessionId])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["stale-first", "idle", "bridge-stale-first"],
      ["stale-last", "idle", "bridge-stale-last"],
    ]);
  }, 60_000);
});
