import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { hireOnto } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a kept window that switches to another conversation", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** A hired employee with a prompt, running in a live process. */
  async function hiredAndRunning() {
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId } = await hireOnto(mac);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    const send = (id: string, event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: id, cwd: folder, ...event });
    await send(sessionId, {
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await send(sessionId, {
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the login bug",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    return { mac, folder, sessionId, send };
  }

  it("moves the mark to the new conversation and sends the old one home, never leaving a not-running desk", async () => {
    // Given a hired employee that has had a prompt
    const { mac, sessionId } = await hiredAndRunning();

    // When /clear moves the same process to a new conversation
    mac.fake.updateSession(sessionId, { sessionId: "after-clear" });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the new conversation carries the mark and the old one went home normally
    const desks = await officeSessions();
    expect(desks.map((d) => d.sessionId)).toEqual(["after-clear"]);
    expect(desks[0]).toMatchObject({ kept: "hired", state: "idle" });
    expect(desks[0]).not.toHaveProperty("notRunning");
    const old = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId });
    expect(old).toMatchObject({ state: "wentHome", hadPrompt: true });
    expect(old?.endedAt).toBeInstanceOf(Date);
    expect(old).not.toHaveProperty("kept");
    expect(old).not.toHaveProperty("notRunning");
  }, 60_000);

  it("moves the mark the same way when the new conversation's SessionStart hook arrives first", async () => {
    // Given a hired employee that has had a prompt
    const { mac, folder, sessionId, send } = await hiredAndRunning();

    // When the process switches conversation and the new conversation's hook is heard before the Mac checks
    mac.fake.updateSession(sessionId, { sessionId: "after-resume" });
    await send("after-resume", {
      hook_event_name: "SessionStart",
      source: "resume",
      cwd: folder,
    });
    await mac.agent.flush();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then only the new conversation is at a desk, marked hired and running
    const desks = await officeSessions();
    expect(desks.map((d) => d.sessionId)).toEqual(["after-resume"]);
    expect(desks[0]).toMatchObject({ kept: "hired", state: "idle" });
    expect(desks[0]).not.toHaveProperty("notRunning");
  }, 60_000);

  it("brings a conversation that had gone home back to its desk, marked hired, when the window resumes it", async () => {
    // Given a hired employee, and an earlier conversation that already went home
    const { mac, folder, sessionId, send } = await hiredAndRunning();
    const gone = await processes.live();
    mac.fake.addSession({
      sessionId: "earlier",
      cwd: folder,
      pid: gone.pid,
      procStart: gone.procStart,
    });
    await send("earlier", {
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await send("earlier", {
      hook_event_name: "UserPromptSubmit",
      prompt: "old",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await gone.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect(
      (
        await (
          await getDb()
        )
          .collection("sessions")
          .findOne({ sessionId: "earlier" })
      )?.state,
    ).toBe("wentHome");

    // When the hired window resumes that conversation
    mac.fake.removeSession("earlier");
    mac.fake.updateSession(sessionId, { sessionId: "earlier" });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the earlier conversation is back at its desk, marked hired, and the window's first one is home
    const desks = await officeSessions();
    expect(desks.map((d) => d.sessionId)).toEqual(["earlier"]);
    expect(desks[0]).toMatchObject({ kept: "hired", state: "idle" });
    expect(desks[0]).not.toHaveProperty("endedAt");
  }, 60_000);

  it("keeps the stored 'had a prompt' mark of a conversation from an earlier agent run when the window resumes it", async () => {
    // Given a hired employee, and a conversation an earlier agent run stored as gone home with a prompt
    const { mac, folder, sessionId } = await hiredAndRunning();
    const sessions = (await getDb()).collection("sessions");
    await sessions.insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      sessionId: "from-before",
      cwd: folder,
      startCwd: folder,
      state: "wentHome",
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(Date.now() - 1_800_000),
      hadPrompt: true,
      changedAt: new Date(),
    });

    // When the window resumes that conversation
    mac.fake.updateSession(sessionId, { sessionId: "from-before" });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it is back at its desk, marked hired, and still known to have had a prompt
    expect(await sessions.findOne({ sessionId: "from-before" })).toMatchObject({
      kept: "hired",
      hadPrompt: true,
    });
  }, 60_000);
});
