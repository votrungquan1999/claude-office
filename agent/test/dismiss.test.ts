import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { WINDOW_NOTES } from "../window-close";
import { hireOnto, postDismiss, postHire, postWake } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const DAY_MS = 86_400_000;

/** Whether a process still exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

describe("dismissing a hired or woken employee", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** The owner dismisses it and the agent picks the order up; returns the order row. */
  async function dismiss(mac: Mac, sessionId: string, endRunning = true) {
    const { response, body } = await postDismiss(
      "machine-air",
      sessionId,
      endRunning,
    );
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

  it("ends a running conversation and the child that outlives it, closes its window once after nothing is left running in its tab, and sends the desk home at the dismiss", async () => {
    // Given a hired employee running as a parent with a child that ignores stdin, inside its window
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId, children: 1 });
    const [child] = conversation.childPids();
    mac.terminal.attach([conversation.pid, child]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
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
    clock = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then the order is done and both the conversation and its child are gone
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(conversation.pid)).toBe(false);
    expect(isAlive(child)).toBe(false);

    // And its window was closed exactly once, after the stand-ins in its tab were gone
    expect(mac.terminal.closes).toEqual([mac.terminal.windows[0]?.id]);
    expect(mac.terminal.closedWhileBusy).toEqual([]);

    // And the desk went home at the dismiss, no longer kept or "Not running"
    expect(await officeSessions()).toEqual([]);
    const [home] = await officeSessions(new Date(clock - 3_600_000));
    expect(home).toMatchObject({ sessionId, state: "wentHome" });
    expect(new Date(home?.endedAt ?? 0).getTime()).toBe(clock);
    expect(home).not.toHaveProperty("kept");
    expect(home).not.toHaveProperty("notRunning");
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

  it("ends a waiting desk whose window already started even before the agent has noticed its registry entry, and sends it home at the dismiss", async () => {
    // Given a hire into an untrusted folder whose window then started, with no reconcile pass since
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireUntrusted(mac);
    const running = await processes.standIn({ sessionId });
    mac.terminal.attach([running.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });

    // When the owner dismisses it
    clock = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then its process is gone, its window closed, and the desk went home at the dismiss
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(running.pid)).toBe(false);
    expect(mac.terminal.closes).toHaveLength(1);
    expect(await officeSessions()).toEqual([]);
    const home = await (await getDb())
      .collection("sessions")
      .findOne({ machineId: "machine-air", sessionId });
    expect(home).toMatchObject({ state: "wentHome" });
    expect(home?.endedAt.getTime()).toBe(clock);
    expect(home).not.toHaveProperty("kept");
    expect(home).not.toHaveProperty("waitingAtMac");
  }, 60_000);

  it("ends a desk waiting at the folder-trust question by its command line, since Claude Code has not registered it, and sends it home", async () => {
    // Given a hire waiting at the trust question, its process running with the session id on its command line and no registry entry
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { sessionId } = await hireUntrusted(mac);
    const waiting = await processes.standIn({ sessionId });
    mac.terminal.attach([waiting.pid]);
    expect((await officeSessions())[0]).toMatchObject({ waitingAtMac: true });

    // When the owner dismisses it
    clock = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then the process is gone, its window closed and the desk went home at the dismiss
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(waiting.pid)).toBe(false);
    expect(mac.terminal.closes).toHaveLength(1);
    expect(await officeSessions()).toEqual([]);
    const home = await (await getDb())
      .collection("sessions")
      .findOne({ machineId: "machine-air", sessionId });
    expect(home?.endedAt.getTime()).toBe(clock);
  }, 60_000);

  it("still ends the conversation when Terminal cannot be controlled, leaves the window open and says so in a note on the done order", async () => {
    // Given a running hire whose Mac has not allowed the agent to control Terminal
    let clock = Date.now() - 60_000;
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.terminal.denyControl();

    // When the owner dismisses it
    clock = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then the process is gone, no window was closed, and the done order says why
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/allow Claude Office to control Terminal/);
    expect(isAlive(conversation.pid)).toBe(false);
    expect(mac.terminal.closes).toEqual([]);
    expect(await officeSessions()).toEqual([]);
  }, 60_000);

  it("ends a conversation that ignores SIGTERM with SIGKILL once the grace has passed", async () => {
    // Given a running hire whose process survives SIGTERM
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const stubborn = await processes.standIn({ sessionId, ignoreTerm: true });
    mac.terminal.attach([stubborn.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: stubborn.pid,
      procStart: stubborn.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses it
    const started = Date.now();
    const order = await dismiss(mac, sessionId);

    // Then it is gone, and only after the grace that SIGTERM was given
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(stubborn.pid)).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(mac.terminal.closes).toHaveLength(1);
  }, 60_000);

  it("never signals a process whose start time differs from the registry's, since its pid was reused", async () => {
    // Given a registry entry whose pid now belongs to an unrelated live process
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const stranger = await processes.standIn();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: stranger.pid,
      procStart: "Mon Jan  1 00:00:00 2001",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses the hire
    const order = await dismiss(mac, sessionId);

    // Then the order is done and the stranger was never touched
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(stranger.pid)).toBe(true);
    // The conversation behind the entry is gone, so only its recorded window closes
    expect(mac.terminal.closes).toEqual([mac.terminal.windows[0]?.id]);
  }, 60_000);

  it("leaves a window open, with a note, when Terminal still counts its tab busy after the sweep found nothing of the office's to end", async () => {
    // Given a running hire whose tab Terminal counts busy through a process ps does not place on the tab's device
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    const unseen = await processes.standIn();
    mac.terminal.attach([conversation.pid]);
    mac.terminal.attachUnseen([unseen.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation ended, the window was left open, the unseen process was not signalled and the note says why
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(conversation.pid)).toBe(false);
    expect(isAlive(unseen.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
    expect(order?.note).toMatch(/still running in it/);
  }, 60_000);

  it("ends a process the conversation left on its tab, found by the fresh process table on the tab's device, then closes the window", async () => {
    // Given a running hire whose tab also holds a process that started after the dismiss's first look, on the same device
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    const leftover = await processes.standIn();
    mac.terminal.attach([conversation.pid, leftover.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the sweep ended the leftover by the tab's device and the window closed without a note
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(conversation.pid)).toBe(false);
    expect(isAlive(leftover.pid)).toBe(false);
    expect(mac.terminal.closes).toEqual([mac.terminal.windows[0]?.id]);
    expect(order).not.toHaveProperty("note");
  }, 60_000);

  it("closes the window the office opened for a Not running desk, found from the record made at launch, though no process is left", async () => {
    // Given a hired employee whose conversation ended and whose window stayed open on "[Process completed]"
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await conversation.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then its window was closed, without a note
    expect(order).toMatchObject({ status: "done" });
    expect(order).not.toHaveProperty("note");
    expect(mac.terminal.closes).toEqual([mac.terminal.windows[0]?.id]);
    expect(await officeSessions()).toEqual([]);
  }, 60_000);

  it("tells the owner to close the window of a Not running desk that has no launch record, instead of ending with no word", async () => {
    // Given a Not running hire whose launch record files are gone, such as one hired before the record existed
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await conversation.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    rmSync(recordFile(mac, sessionId, "window"), { force: true });
    rmSync(recordFile(mac, sessionId, "tty"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the order is done with a note that the window stays open, and nothing was closed
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toBe(WINDOW_NOTES.noWindowId);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("leaves the window of a Not running desk open, with a note, and ends nothing when something now runs on its device", async () => {
    // Given a Not running hire whose window's device now carries a process the office did not start
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    await conversation.kill();
    const resumed = await processes.standIn();
    mac.terminal.attach([resumed.pid]);
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the window stays open, the process on its device is untouched and the note says why
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toBe(WINDOW_NOTES.busy);
    expect(isAlive(resumed.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends the conversation but leaves a window that holds other tabs open, with the note saying so", async () => {
    // Given a running hire whose window also has a second tab
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    mac.terminal.addTab();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation ended, nothing was closed and the note says why
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toBe(WINDOW_NOTES.otherTabs);
    expect(isAlive(conversation.pid)).toBe(false);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("only stops keeping a desk whose conversation now runs in a window the owner opened by hand, ending nothing and closing nothing", async () => {
    // Given a hire whose conversation was later resumed in another window, which the office did not open
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const byHand = mac.terminal.openByHand();
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid], byHand);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "resume",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on in its window, which stays open, the desk is no longer kept and the note says it was left running
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId });
    expect(desk).not.toHaveProperty("kept");
  }, 60_000);

  it("ends nothing when the conversation runs on another terminal device than the one recorded at launch, even while Terminal control is denied, and says so", async () => {
    // Given a hire whose conversation was resumed in a window the owner opened by hand, and a Mac that has not allowed Terminal control
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const byHand = mac.terminal.openByHand();
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid], byHand);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.terminal.denyControl();

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on, nothing was closed, the desk is no longer kept and the note says it was left running
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
    const [desk] = await officeSessions();
    expect(desk).not.toHaveProperty("kept");
  }, 60_000);

  /** The launch record files of one hire: the device the script wrote and the window id the agent found. */
  const recordFile = (mac: Mac, sessionId: string, extension: string) =>
    join(
      mac.fake.home,
      ".claude-office",
      "launch",
      `${sessionId}.${extension}`,
    );

  /** A running hire in its own window with the stand-in attached, ready to dismiss. */
  async function runningHire(mac: Mac) {
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    return { folder, sessionId, conversation };
  }

  it("only stops keeping a running desk, ending and closing nothing, when the dismiss does not ask to end it, as from a page without the warning pop-up", async () => {
    // Given a running hire in the office's own window
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);

    // When a dismiss arrives that does not ask to end a running conversation
    const order = await dismiss(mac, sessionId, false);

    // Then the conversation lives on, no window closed, and the desk is no longer kept
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId });
    expect(desk).not.toHaveProperty("kept");
  }, 60_000);

  it("ends nothing when only the terminal device was recorded and the conversation runs on another device", async () => {
    // Given a hire with no window id on record whose conversation was resumed in a window the owner opened by hand
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Fix the login bug");
    const byHand = mac.terminal.openByHand();
    const conversation = await processes.standIn({ sessionId });
    mac.terminal.attach([conversation.pid], byHand);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: conversation.pid,
      procStart: conversation.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    rmSync(recordFile(mac, sessionId, "window"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on and the note says it was left running
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends the conversation when only the terminal device was recorded and the conversation runs on it", async () => {
    // Given a running hire with no window id on record
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    rmSync(recordFile(mac, sessionId, "window"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then its device proves the tab is the office's, so the conversation ended and the window found by that device was closed
    expect(order).toMatchObject({ status: "done" });
    expect(isAlive(conversation.pid)).toBe(false);
    expect(mac.terminal.closes).toEqual([mac.terminal.windows[0]?.id]);
    expect(order).not.toHaveProperty("note");
  }, 60_000);

  it("ends nothing when the recorded window id is not the window Terminal shows for the conversation's device", async () => {
    // Given a running hire whose recorded window id names another window
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    writeFileSync(recordFile(mac, sessionId, "window"), "999999");

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on and nothing was closed
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends nothing when another process, started by hand, runs the conversation on the device the launch recorded, with no window id on record", async () => {
    // Given a hire whose own claude ended, and a hand resume of the conversation that reuses its terminal device
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId, conversation } = await runningHire(mac);
    await conversation.kill();
    const resumed = await processes.standIn({ sessionId, resume: true });
    mac.terminal.attach([resumed.pid]);
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: resumed.pid,
      procStart: resumed.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    rmSync(recordFile(mac, sessionId, "window"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the hand-resumed conversation lives on and the note says it was left running
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(resumed.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends nothing when the launch record has the conversation's device and pid but another start time, since its pid was reused", async () => {
    // Given a running hire whose launch record names the same pid with an earlier start time
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    writeFileSync(
      recordFile(mac, sessionId, "pid"),
      `${conversation.pid} Mon Jan  1 00:00:00 2001`,
    );

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on, nothing was closed and the note says it was left running
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends nothing when the launch record holds no pid, as on a desk hired by an earlier build", async () => {
    // Given a running hire whose pid record is gone but whose device and window are recorded
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    rmSync(recordFile(mac, sessionId, "pid"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on and the note says it was left running
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("tells the owner to close the window of a Not running desk whose device is recorded but whose window id never was", async () => {
    // Given a Not running hire whose window id was never recorded
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    await conversation.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    rmSync(recordFile(mac, sessionId, "window"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then nothing was closed and the note says the window stays open
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toBe(WINDOW_NOTES.noWindowId);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends done with a note, not failed, when the process list cannot be read once the conversation was signalled", async () => {
    // Given a running hire, and a Mac whose process list can be read only until the conversation is signalled
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId } = await runningHire(mac);
    mac.terminal.failProcessTableAfter(2);

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the order is done, the note says the Mac's process list could not be read and the desk is no longer kept
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/process list could not be read/);
    const [desk] = await officeSessions();
    expect(desk).not.toHaveProperty("kept");
  }, 60_000);

  it("ends done with a note, not failed, when the process list cannot be read for a Not running desk", async () => {
    // Given a Not running hire and a Mac whose process list can be read once
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    await conversation.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.terminal.failProcessTableAfter(1);

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the order is done with the same note and nothing was closed
    expect(order).toMatchObject({ status: "done" });
    expect(order?.note).toMatch(/process list could not be read/);
    expect(mac.terminal.closes).toEqual([]);
  }, 60_000);

  it("ends nothing for a desk with no launch record at all, such as one hired before the record existed", async () => {
    // Given a running hire whose launch record files are gone
    const mac = await setUpMac("machine-air", "Air");
    const { sessionId, conversation } = await runningHire(mac);
    rmSync(recordFile(mac, sessionId, "window"), { force: true });
    rmSync(recordFile(mac, sessionId, "tty"), { force: true });

    // When the owner dismisses it
    const order = await dismiss(mac, sessionId);

    // Then the conversation lives on, the desk is no longer kept and the note says it was left running
    expect(order?.note).toMatch(/left running/);
    expect(isAlive(conversation.pid)).toBe(true);
    expect(mac.terminal.closes).toEqual([]);
    const [desk] = await officeSessions();
    expect(desk).not.toHaveProperty("kept");
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

  it("deletes at start-up the window records of conversations that are not kept desks, and keeps those of kept desks for a later Dismiss", async () => {
    // Given a kept hire with window records, and records left by a conversation that is no longer kept
    const first = await setUpMac("machine-air", "Air");
    const { sessionId } = await hireUntrusted(first);
    const gone = randomUUID();
    for (const id of [sessionId, gone]) {
      writeFileSync(recordFile(first, id, "tty"), "/dev/ttys009\n");
      writeFileSync(
        recordFile(first, id, "pid"),
        "4242 Sat Nov 14 08:00:00 2026\n",
      );
      writeFileSync(recordFile(first, id, "window"), "7001");
    }

    // When the agent restarts
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Air", { fake: first.fake });
    await second.agent.flush();

    // Then only the kept desk's records are left
    for (const extension of ["tty", "pid", "window"]) {
      expect(existsSync(recordFile(second, gone, extension))).toBe(false);
      expect(existsSync(recordFile(second, sessionId, extension))).toBe(true);
    }
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
