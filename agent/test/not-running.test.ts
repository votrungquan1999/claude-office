import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hireOnto } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a hired employee whose Terminal window closed", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("stays at its desk as idle and not running, with nothing running and no Remote Control link, when its process dies", async () => {
    // Given a hired employee that is working a tool, with a Remote Control link
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(mac);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { description: "Long build" },
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    const [before] = await officeSessions();
    expect(before).toMatchObject({
      state: "working",
      bridgeSessionId: "bridge-hired",
    });
    expect(before?.runningSteps).toHaveLength(1);

    // When the window is closed and the Mac checks its sessions
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk is still there: idle, marked not running, nothing running, no link, not gone home
    const desks = await officeSessions();
    expect(desks).toHaveLength(1);
    const [desk] = desks;
    expect(desk).toMatchObject({
      sessionId,
      kept: "hired",
      state: "idle",
      notRunning: true,
    });
    expect(desk).not.toHaveProperty("endedAt");
    expect(desk).not.toHaveProperty("bridgeSessionId");
    expect(desk).not.toHaveProperty("runningSteps");
    expect(desk).not.toHaveProperty("currentTodo");
  }, 60_000);

  it("stays an idle not-running desk when its end hook fires while the process is still listed", async () => {
    // Given a hired employee waiting on a permission dialog
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(mac);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]?.state).toBe("needsPermission");

    // When the end hook fires while the process is still listed
    await send({ hook_event_name: "SessionEnd", reason: "other" });
    await mac.agent.flush();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk is idle and not running, never counted as needing the owner
    const desks = await officeSessions();
    expect(desks).toHaveLength(1);
    expect(desks[0]).toMatchObject({
      sessionId,
      kept: "hired",
      state: "idle",
      notRunning: true,
    });
    expect(desks[0]).not.toHaveProperty("endedAt");
  }, 60_000);

  it("is still at its desk with its mark and name after the agent restarts while the window is closed", async () => {
    // Given a hired employee named from its first message whose window then closed
    const first = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(first);
    const running = await processes.live();
    first.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(first.fake.home, {
        session_id: sessionId,
        cwd: folder,
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the login bug",
    });
    await first.agent.reconcile();
    await first.agent.flush();
    await running.kill();
    await first.agent.reconcile();
    await first.agent.flush();
    const [stopped] = await officeSessions();
    expect(stopped).toMatchObject({
      notRunning: true,
      deskName: "Fix the login bug",
    });

    // When the agent restarts on the same Mac
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Quan's MacBook Air", {
      fake: first.fake,
    });
    await second.agent.flush();

    // Then the desk is still there, not running, with its mark, its name and its time of closing
    const desks = await officeSessions();
    expect(desks).toHaveLength(1);
    expect(desks[0]).toMatchObject({
      sessionId,
      kept: "hired",
      state: "idle",
      notRunning: true,
      deskName: "Fix the login bug",
      stateSince: stopped?.stateSince,
    });
    expect(desks[0]).not.toHaveProperty("endedAt");
  }, 60_000);

  it("keeps its mark and Remote Control link when the agent restarts while the window is still open", async () => {
    // Given a hired employee whose window is open
    const first = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(first);
    const running = await processes.live();
    first.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    await runHook(first.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await first.agent.reconcile();
    await first.agent.flush();

    // When the agent restarts
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Quan's MacBook Air", {
      fake: first.fake,
    });
    await second.agent.flush();

    // Then the desk is still marked hired, running, with its link
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      kept: "hired",
      bridgeSessionId: "bridge-hired",
    });
    expect(desk).not.toHaveProperty("notRunning");
  }, 60_000);
  /** A hired employee whose window is open, then an agent restart while the registry folder cannot be listed. */
  async function restartWithoutRegistry() {
    const first = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(first);
    const running = await processes.live();
    first.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    await runHook(first.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await first.agent.reconcile();
    await first.agent.flush();
    await first.agent.stop();
    const sessionsDir = join(first.fake.home, ".claude", "sessions");
    rmSync(sessionsDir, { recursive: true });
    const second = await setUpMac("machine-air", "Quan's MacBook Air", {
      fake: first.fake,
    });
    await second.agent.flush();
    return { second, running, folder, sessionId, sessionsDir };
  }

  it("is not marked not running by an agent restart that cannot read the registry, and shows its link again once the registry is back", async () => {
    // Given an open hired window and an agent that restarted while the registry could not be listed
    const { second, running, folder, sessionId, sessionsDir } =
      await restartWithoutRegistry();

    // Then the desk does not read Not running
    expect((await officeSessions())[0]).not.toHaveProperty("notRunning");

    // When the registry is readable again and lists the live window
    mkdirSync(sessionsDir, { recursive: true });
    second.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    await second.agent.reconcile();
    await second.agent.flush();

    // Then it is running with its link
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId, bridgeSessionId: "bridge-hired" });
    expect(desk).not.toHaveProperty("notRunning");
  }, 60_000);

  it("shows Not running once the registry is readable and has no live entry for a desk it could not judge at restart", async () => {
    // Given an agent that restarted while the registry could not be listed, and a window that closed meanwhile
    const { second, running, sessionsDir } = await restartWithoutRegistry();
    await running.kill();

    // When the registry is readable again and lists nothing for it
    mkdirSync(sessionsDir, { recursive: true });
    await second.agent.reconcile();
    await second.agent.flush();

    // Then the desk shows Not running
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });
  }, 60_000);

  it("never shows the dead window's Remote Control link when the conversation is resumed elsewhere", async () => {
    // Given a hired employee with a link whose window closed
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(mac);
    const closing = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: closing.pid,
      procStart: closing.procStart,
      bridgeSessionId: "bridge-dead",
    });
    await mac.agent.reconcile();
    await closing.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When the owner resumes it elsewhere and the new process has no link yet
    const again = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: again.pid,
      procStart: again.procStart,
      startedAt: 1_700_000_100_000,
    });
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "resume",
    });
    await mac.agent.flush();

    // Then the desk is running with no link, not the dead one
    const [desk] = await officeSessions();
    expect(desk).not.toHaveProperty("notRunning");
    expect(desk).not.toHaveProperty("bridgeSessionId");
  }, 60_000);
});
