import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { hireOnto, postDismiss, postHire, postWake } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const DAY_MS = 86_400_000;

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

describe("dismissing a hired or woken employee", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** The owner dismisses it and the agent picks the order up; returns the order row. */
  async function dismiss(mac: Mac, sessionId: string) {
    const { response, body } = await postDismiss("machine-air", sessionId);
    expect(response.status).toBe(200);
    await mac.agent.pollCommands();
    await mac.agent.flush();
    return (await getDb())
      .collection("commands")
      .findOne({ _id: body?.orderId as never });
  }

  /** Hires into a folder Claude Code has not trusted, so the desk waits at the Mac and no registry entry appears. */
  async function hireUntrusted(mac: Mac, message = "Fix the login bug") {
    const folder = mac.fake.makeFolder("untrusted");
    mac.fake.trust(folder, false);
    await (await getDb()).collection("folders").insertOne({
      machineId: "machine-air",
      path: folder,
      companyMode: true,
      firstSeenAt: new Date(),
    });
    const { body } = await postHire("machine-air", folder, message);
    await mac.agent.pollCommands();
    await mac.agent.flush();
    return { folder, sessionId: body?.sessionId ?? "" };
  }

  const launchFiles = (mac: Mac, sessionId: string) =>
    ["command", "msg"].map((extension) =>
      join(
        mac.fake.home,
        ".claude-office",
        "launch",
        `${sessionId}.${extension}`,
      ),
    );

  it("sends a not-running employee home at the moment of the dismiss, not when its window closed", async () => {
    // Given a hired employee that had a prompt and whose window closed two days ago on the Mac's clock
    let clock = Date.now() - 2 * DAY_MS;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the login bug",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({
      kept: "hired",
      notRunning: true,
    });

    // When the owner dismisses it two days later
    clock = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then the order is done and the desk went home at the dismiss, no longer kept
    expect(order).toMatchObject({ status: "done" });
    expect(await officeSessions()).toEqual([]);
    const today = await officeSessions(new Date(clock - 3_600_000));
    expect(today).toHaveLength(1);
    const [desk] = today;
    expect(desk).toMatchObject({
      sessionId,
      state: "wentHome",
      hadPrompt: true,
    });
    expect(new Date(desk?.endedAt ?? 0).getTime()).toBe(clock);
    expect(desk).not.toHaveProperty("kept");
    expect(desk).not.toHaveProperty("notRunning");
  }, 60_000);

  it("leaves the running conversation alone: the mark goes, the desk stays running, and it goes home at its real end when the window closes", async () => {
    // Given a hired employee with a live process and a prompt
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
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
    await send({
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the login bug",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the order is done, the process is still alive and the desk is still running without the mark
    expect(order).toMatchObject({ status: "done" });
    expect(mac.terminal.opened).toHaveLength(1);
    expect(() => process.kill(running.pid, 0)).not.toThrow();
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      state: "thinking",
      bridgeSessionId: "bridge-hired",
    });
    expect(desk).not.toHaveProperty("kept");

    // When the window closes later
    clock = Date.now();
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it goes home at that moment, not "Not running"
    expect(await officeSessions()).toEqual([]);
    const [home] = await officeSessions(new Date(clock - 3_600_000));
    expect(home).toMatchObject({ sessionId, state: "wentHome" });
    expect(new Date(home?.endedAt ?? 0).getTime()).toBe(clock);
    expect(home).not.toHaveProperty("notRunning");
    expect(home).not.toHaveProperty("kept");
  }, 60_000);

  it("sends a hire that never started home with no went-home entry, removes its launch files and keeps the message out of the order", async () => {
    // Given a hire into an untrusted folder, waiting at the Mac with its launch files on disk
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId } = await hireUntrusted(mac);
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      waitingAtMac: true,
      kept: "hired",
    });
    expect(launchFiles(mac, sessionId).every(existsSync)).toBe(true);

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the desk is gone from the office and from today's list, both launch files are deleted and the order never held the message
    expect(order).toMatchObject({ status: "done" });
    expect(order).not.toHaveProperty("firstMessage");
    expect(await officeSessions(new Date(Date.now() - 3_600_000))).toEqual([]);
    expect(launchFiles(mac, sessionId).some(existsSync)).toBe(false);
    const row = await (await getDb())
      .collection("sessions")
      .findOne({ machineId: "machine-air", sessionId });
    expect(row).toMatchObject({ state: "wentHome", hadPrompt: false });
    expect(row).not.toHaveProperty("waitingAtMac");
    expect(row).not.toHaveProperty("kept");
  }, 60_000);

  it("lets a window the owner dismissed at the trust question be woken later, not refused as open elsewhere", async () => {
    // Given a hire into an untrusted folder that never registered, dismissed, with a conversation on disk
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId } = await hireUntrusted(mac);
    await dismiss(mac, sessionId);
    mac.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the login bug" } },
    ]);
    expect(mac.terminal.opened).toHaveLength(1);

    // When the owner wakes it
    const { response, body } = await postWake("machine-air", sessionId);
    expect(response.status).toBe(200);
    await mac.agent.pollCommands();

    // Then the order is done and a second window opened
    const order = await (await getDb())
      .collection("commands")
      .findOne({ _id: body?.orderId as never });
    expect(order).toMatchObject({ status: "done" });
    expect(mac.terminal.opened).toHaveLength(2);
  }, 60_000);

  it("shows a normal, not kept desk when Claude Code starts in a window after the owner dismissed its wait, without dropping its first hook", async () => {
    // Given a hire into an untrusted folder that was dismissed while waiting
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireUntrusted(mac);
    await dismiss(mac, sessionId);

    // When the owner answers the trust question anyway and Claude Code starts and takes a prompt
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
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it is a running desk with no kept mark and no waiting flag
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      state: "thinking",
      hadPrompt: true,
    });
    expect(desk).not.toHaveProperty("kept");
    expect(desk).not.toHaveProperty("waitingAtMac");
    expect(desk).not.toHaveProperty("endedAt");
  }, 60_000);

  it("treats a waiting desk whose window already started as running, even before the agent has noticed its registry entry", async () => {
    // Given a hire into an untrusted folder whose window then started, with no reconcile pass since
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireUntrusted(mac);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the desk is still there, running and unkept, not sent home
    expect(order).toMatchObject({ status: "done" });
    expect(await officeSessions()).toHaveLength(1);
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId });
    expect(desk).not.toHaveProperty("kept");
    expect(desk).not.toHaveProperty("endedAt");
    expect(desk).not.toHaveProperty("waitingAtMac");

    // When it takes a prompt and its window closes
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await mac.agent.flush();
    clock = Date.now();
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it goes home at that moment
    expect(await officeSessions()).toEqual([]);
    const [home] = await officeSessions(new Date(clock - 3_600_000));
    expect(home).toMatchObject({ sessionId, state: "wentHome" });
    expect(new Date(home?.endedAt ?? 0).getTime()).toBe(clock);
  }, 60_000);

  it("sends a woken employee that is still waiting at the Mac home at the moment of the dismiss, listed in today's departures", async () => {
    // Given a plain session that had a prompt and went home two days ago on the Mac's clock, then was woken into an untrusted folder
    let clock = Date.now() - 2 * DAY_MS;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const folder = mac.fake.makeFolder("untrusted");
    mac.fake.trust(folder, false);
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const running = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "Fix the bug" });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await running.kill();
    mac.fake.removeSession(sessionId);
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the bug" } },
    ]);
    expect((await postWake("machine-air", sessionId)).response.status).toBe(
      200,
    );
    await mac.agent.pollCommands();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      kept: "woken",
      waitingAtMac: true,
    });

    // When the owner dismisses it
    clock = Date.now();
    await dismiss(mac, sessionId);

    // Then it went home at the dismiss and tops today's departures, no longer kept or waiting
    expect(await officeSessions()).toEqual([]);
    const [home] = await officeSessions(new Date(clock - 3_600_000));
    expect(home).toMatchObject({
      sessionId,
      state: "wentHome",
      hadPrompt: true,
    });
    expect(new Date(home?.endedAt ?? 0).getTime()).toBe(clock);
    expect(home).not.toHaveProperty("kept");
    expect(home).not.toHaveProperty("waitingAtMac");
  }, 60_000);

  it("sends a woken employee home when the registry still holds only the old process's dead entry, instead of adopting it as running", async () => {
    // Given a session that went home but whose dead registry entry stays on disk, then woken into an untrusted folder
    let clock = Date.now() - 2 * DAY_MS;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const folder = mac.fake.makeFolder("untrusted");
    mac.fake.trust(folder, false);
    const sessionId = "00000000-0000-4000-8000-000000000005";
    const old = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: old.pid,
      procStart: old.procStart,
    });
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the bug",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await old.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the bug" } },
    ]);
    expect((await postWake("machine-air", sessionId)).response.status).toBe(
      200,
    );
    await mac.agent.pollCommands();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      kept: "woken",
      waitingAtMac: true,
    });

    // When the owner dismisses it before the new window registers
    clock = Date.now();
    await dismiss(mac, sessionId);

    // Then the desk went home at the dismiss, not running behind the old process
    expect(await officeSessions()).toEqual([]);
    const [home] = await officeSessions(new Date(clock - 3_600_000));
    expect(home).toMatchObject({ sessionId, state: "wentHome" });
    expect(new Date(home?.endedAt ?? 0).getTime()).toBe(clock);
    expect(home).not.toHaveProperty("running");
    expect(home).not.toHaveProperty("kept");
    expect(home).not.toHaveProperty("waitingAtMac");
  }, 60_000);

  it("ends a dismiss order for a session id that is not a UUID failed as invalid, changing nothing", async () => {
    // Given a dismiss order whose session id holds a path
    const mac = await setUpMac("machine-air", "Air");
    const _id = randomUUID();
    await (await getDb()).collection("commands").insertOne({
      _id: _id as never,
      machineId: "machine-air",
      kind: "dismiss",
      status: "pending",
      sessionId: "../../escape",
      folder: "/work",
      createdAt: new Date(),
      expireAt: new Date(Date.now() + 600_000),
    });

    // When the agent picks the order up
    await mac.agent.pollCommands();

    // Then it failed as invalid
    expect(
      await (await getDb())
        .collection("commands")
        .findOne({ _id: _id as never }),
    ).toMatchObject({ status: "failed", reason: "invalidOrder" });
  });

  it("ends done for an employee that is no longer kept, changing nothing", async () => {
    // Given a plain running session and a dismiss order for it, as a second click that raced the first would leave
    const mac = await setUpMac("machine-air", "Air");
    const running = await processes.live();
    mac.fake.addSession({
      sessionId: "00000000-0000-4000-8000-000000000006",
      cwd: "/work/plain",
      pid: running.pid,
      procStart: running.procStart,
    });
    await runHook(mac.fake.home, {
      session_id: "00000000-0000-4000-8000-000000000006",
      cwd: "/work/plain",
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    const _id = randomUUID();
    await (await getDb()).collection("commands").insertOne({
      _id: _id as never,
      machineId: "machine-air",
      kind: "dismiss",
      status: "pending",
      sessionId: "00000000-0000-4000-8000-000000000006",
      folder: "/work/plain",
      createdAt: new Date(),
      expireAt: new Date(Date.now() + 600_000),
    });

    // When the agent picks the order up
    await mac.agent.pollCommands();
    await mac.agent.flush();

    // Then the order is done and the session is untouched
    expect(
      await (await getDb())
        .collection("commands")
        .findOne({ _id: _id as never }),
    ).toMatchObject({ status: "done" });
    expect((await officeSessions())[0]).toMatchObject({
      sessionId: "00000000-0000-4000-8000-000000000006",
      state: "idle",
    });
  }, 60_000);

  it("dismisses a desk still waiting at the Mac after the agent restarted and forgot the launch", async () => {
    // Given a hire waiting at the Mac whose agent then restarted
    const first = await setUpMac("machine-air", "Air");
    const { sessionId } = await hireUntrusted(first);
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Air", { fake: first.fake });
    await second.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      waitingAtMac: true,
      kept: "hired",
    });

    // When the owner dismisses it
    const order = await dismiss(second, sessionId);

    // Then the order is done and the desk is gone, so a later wake is not refused as open elsewhere
    expect(order).toMatchObject({ status: "done" });
    expect(await officeSessions()).toEqual([]);
    second.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the login bug" } },
    ]);
    const woke = await postWake("machine-air", sessionId);
    expect(woke.response.status).toBe(200);
    await second.agent.pollCommands();
    expect(
      await (await getDb())
        .collection("commands")
        .findOne({ _id: woke.body?.orderId as never }),
    ).toMatchObject({ status: "done" });
  }, 60_000);
});
