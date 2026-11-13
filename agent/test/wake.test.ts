import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/mongo";
import { hireOnto, postWake } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

describe("waking an employee that is not open", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** A plain session that had a prompt and whose process then ended, so it went home. */
  async function wentHome(
    mac: Mac,
    folder: string,
    sessionId = "00000000-0000-4000-8000-000000000001",
  ) {
    const running = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-old",
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
    mac.fake.removeSession(sessionId);
    await mac.agent.reconcile();
    await mac.agent.flush();
    return sessionId;
  }

  /** The owner wakes it and the agent picks the order up; returns the order row. */
  async function wake(mac: Mac, sessionId: string) {
    const { response, body } = await postWake("machine-air", sessionId);
    expect(response.status).toBe(200);
    await mac.agent.pollCommands();
    return (await getDb())
      .collection("commands")
      .findOne({ _id: body?.orderId as never });
  }

  /** A second wake order for the session, stored as a race past the route's check would leave it. */
  async function insertWakeOrder(sessionId: string, folder: string) {
    const _id = randomUUID();
    await (await getDb()).collection("commands").insertOne({
      _id: _id as never,
      machineId: "machine-air",
      kind: "wake",
      status: "pending",
      sessionId,
      folder,
      createdAt: new Date(),
      expireAt: new Date(Date.now() + 600_000),
    });
    return { body: { orderId: _id } };
  }

  it("is refused as open elsewhere, and nothing opens, when a live registry entry already has the session id", async () => {
    // Given a session that went home, and then another process resumed the same conversation
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    const elsewhere = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: elsewhere.pid,
      procStart: elsewhere.procStart,
    });

    // When the owner wakes it and the agent picks the order up
    const order = await wake(mac, sessionId);

    // Then the order failed as open elsewhere and no window opened
    expect(order).toMatchObject({ status: "failed", reason: "openElsewhere" });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("is refused as open elsewhere when the live entry with the session id is a hidden `claude -p` run", async () => {
    // Given a session that went home and a live `claude -p` run on the same conversation, which the office never shows
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    const printRun = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: printRun.pid,
      procStart: printRun.procStart,
      entrypoint: "sdk-cli",
    });

    // When the owner wakes it
    const order = await wake(mac, sessionId);

    // Then it is refused and nothing opens
    expect(order).toMatchObject({ status: "failed", reason: "openElsewhere" });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("is refused, and nothing opens, when the registry cannot be read", async () => {
    // Given a session that went home and a registry folder that has vanished
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    rmSync(join(mac.fake.home, ".claude", "sessions"), { recursive: true });

    // When the owner wakes it
    const order = await wake(mac, sessionId);

    // Then the order failed as not checkable and no window opened, since an open session could not be ruled out
    expect(order).toMatchObject({
      status: "failed",
      reason: "cannotCheckOpen",
    });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("is refused, and nothing opens, when the process table cannot be read", async () => {
    // Given a session that went home and a Mac whose `ps` stops working
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    const noPs = mkdtempSync(join(tmpdir(), "claude-office-nopath-"));
    vi.stubEnv("PATH", noPs);

    // When the owner wakes it
    let order: Awaited<ReturnType<typeof wake>>;
    try {
      order = await wake(mac, sessionId);
    } finally {
      vi.unstubAllEnvs();
      rmSync(noPs, { recursive: true, force: true });
    }

    // Then the order failed as not checkable and no window opened
    expect(order).toMatchObject({
      status: "failed",
      reason: "cannotCheckOpen",
    });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("opens a window resuming the conversation in its start folder, and the employee comes back kept as woken, waiting at the Mac in an untrusted folder, then with the same Remote Control link once Claude Code registers", async () => {
    // Given a session that went home from a folder Claude Code has not trusted, with its transcript on disk
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("it's app");
    mac.fake.trust(folder, false);
    const sessionId = await wentHome(mac, folder);
    mac.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the login bug" } },
    ]);

    // When the owner wakes it and the agent picks the order up
    const order = await wake(mac, sessionId);
    await mac.agent.flush();

    // Then one script resumes the conversation with Remote Control in the start folder and carries no message
    expect(order).toMatchObject({ status: "done" });
    expect(mac.terminal.opened).toHaveLength(1);
    const text = readFileSync(mac.terminal.opened[0], "utf8");
    expect(text).toContain(`cd '${folder.replaceAll("'", "'\\''")}'`);
    expect(text).toContain(`--resume ${sessionId} --remote-control`);
    expect(text).not.toContain('"$msg"');

    // And the desk is back, kept as woken, waiting at the Mac, with its old name
    const [waiting] = await officeSessions();
    expect(waiting).toMatchObject({
      sessionId,
      kept: "woken",
      state: "needsPermission",
      waitingAtMac: true,
      deskName: "Fix the login bug",
    });
    expect(waiting).not.toHaveProperty("endedAt");

    // When Claude Code starts in the window with the same Remote Control link
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-old",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it is a normal woken desk with the link it had before
    const [normal] = await officeSessions();
    expect(normal).toMatchObject({
      sessionId,
      kept: "woken",
      state: "idle",
      bridgeSessionId: "bridge-old",
    });
    expect(normal).not.toHaveProperty("waitingAtMac");
    expect(normal).not.toHaveProperty("starting");
  });

  it("fails as folder missing when the start folder is gone, and as conversation not found when the transcript is gone, opening nothing", async () => {
    // Given one went-home session whose folder was deleted and one whose transcript is missing
    const mac = await setUpMac("machine-air", "Air");
    const gone = mac.fake.makeFolder("gone");
    const goneId = await wentHome(
      mac,
      gone,
      "00000000-0000-4000-8000-000000000002",
    );
    mac.fake.addTranscript(goneId, [{ type: "user" }]);
    rmSync(gone, { recursive: true });
    const there = mac.fake.makeFolder("there");
    const lostId = await wentHome(
      mac,
      there,
      "00000000-0000-4000-8000-000000000003",
    );

    // When the owner wakes each
    const folderOrder = await wake(mac, goneId);
    const transcriptOrder = await wake(mac, lostId);

    // Then each order failed with its own reason and no window opened
    expect(folderOrder).toMatchObject({
      status: "failed",
      reason: "folderMissing",
    });
    expect(transcriptOrder).toMatchObject({
      status: "failed",
      reason: "conversationNotFound",
    });
    expect(mac.terminal.opened).toEqual([]);
  }, 60_000);

  it("resumes in the start folder it stored for the conversation, not the folder written in the order", async () => {
    // Given a went-home session that started in one folder, and a wake order that names another existing folder
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const elsewhere = mac.fake.makeFolder("elsewhere");
    const sessionId = await wentHome(mac, folder);
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);
    const order = await insertWakeOrder(sessionId, elsewhere);

    // When the agent picks the order up
    await mac.agent.pollCommands();

    // Then the window opens in the stored folder
    expect(mac.terminal.opened).toHaveLength(1);
    const script = readFileSync(mac.terminal.opened[0], "utf8");
    expect(script).toContain(`cd '${folder}'`);
    expect(script).not.toContain(elsewhere);
    expect(
      await (await getDb())
        .collection("commands")
        .findOne({ _id: order.body.orderId as never }),
    ).toMatchObject({ status: "done" });
  }, 60_000);

  it("ends a wake order for a session id that is not a UUID failed as invalid, opening nothing", async () => {
    // Given a wake order whose session id holds shell syntax
    const mac = await setUpMac("machine-air", "Air");
    const order = await insertWakeOrder("x; touch /tmp/pwn #", "/work");

    // When the agent picks the order up
    await mac.agent.pollCommands();

    // Then it failed as invalid and nothing opened
    expect(
      await (await getDb())
        .collection("commands")
        .findOne({ _id: order.body.orderId as never }),
    ).toMatchObject({ status: "failed", reason: "invalidOrder" });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("refuses a second wake of the same conversation while the first is still waiting for Claude Code, opening one window", async () => {
    // Given a went-home session and two wake orders given before the agent picks either up
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);
    const first = await postWake("machine-air", sessionId);
    const second = await insertWakeOrder(sessionId, folder);

    // When the agent works through both
    await mac.agent.pollCommands();

    // Then the first opened a window and the second was refused as open elsewhere
    const orders = (await getDb()).collection("commands");
    expect(
      await orders.findOne({ _id: first.body?.orderId as never }),
    ).toMatchObject({
      status: "done",
    });
    expect(
      await orders.findOne({ _id: second.body?.orderId as never }),
    ).toMatchObject({
      status: "failed",
      reason: "openElsewhere",
    });
    expect(mac.terminal.opened).toHaveLength(1);
  });

  it("opens one window when two polls run at once and each claims a different wake order for the same conversation", async () => {
    // Given a went-home session, two wake orders, and a Terminal that opens only once released
    const calls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mac = await setUpMac("machine-air", "Air", {
      terminalOpener: async (script) => {
        calls.push(script);
        await gate;
      },
    });
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);
    const first = await postWake("machine-air", sessionId);
    const second = await insertWakeOrder(sessionId, folder);

    // When both polls start before the Terminal answers
    const a = mac.agent.pollCommands();
    const b = mac.agent.pollCommands();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    release();
    await Promise.all([a, b]);

    // Then exactly one window opened, one order is done and the other failed as open elsewhere
    expect(calls).toHaveLength(1);
    const orders = (await getDb()).collection("commands");
    const outcomes = [
      await orders.findOne({ _id: first.body?.orderId as never }),
      await orders.findOne({ _id: second.body?.orderId as never }),
    ].map((order) => [order?.status, order?.reason]);
    expect(outcomes).toEqual([
      ["done", undefined],
      ["failed", "openElsewhere"],
    ]);
  });

  it("leaves a woken employee at its desk as not running when its window closes", async () => {
    // Given a woken employee whose window registered in a trusted folder
    const mac = await setUpMac("machine-air", "Air");
    const repo = mac.fake.makeGitRoot("repo");
    mac.fake.trust(repo, true);
    const sessionId = await wentHome(mac, repo);
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);
    await wake(mac, sessionId);
    await mac.agent.flush();
    const [starting] = await officeSessions();
    expect(starting).toMatchObject({
      kept: "woken",
      starting: true,
      state: "idle",
    });
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: repo,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-old",
    });
    await mac.agent.reconcile();

    // When the window closes
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk stays, marked not running, and no link is offered
    const [closed] = await officeSessions();
    expect(closed).toMatchObject({
      sessionId,
      kept: "woken",
      state: "idle",
      notRunning: true,
    });
    expect(closed).not.toHaveProperty("bridgeSessionId");
  });

  it("wakes a conversation the restarted agent no longer tracks, with its stored name and start folder", async () => {
    // Given a session that went home, then the agent restarts before the owner wakes it
    const first = await setUpMac("machine-air", "Air");
    const folder = first.fake.makeFolder("app");
    first.fake.trust(folder, false);
    const sessionId = await wentHome(first, folder);
    first.fake.addTranscript(sessionId, [{ type: "user" }]);
    await first.agent.stop();
    // Stored as it was when the employee last ran: working below its start folder, with tags and a start time
    const subfolder = join(folder, "src");
    const startedAt = new Date("2026-11-01T08:00:00.000Z");
    await (await getDb()).collection("sessions").updateOne(
      { sessionId },
      {
        $set: {
          startCwd: folder,
          cwd: subfolder,
          startedAt,
          tags: [{ name: "app", key: "repo-app" }],
        },
      },
    );
    const mac = await setUpMac("machine-air", "Air", { fake: first.fake });

    // When the owner wakes it
    const order = await wake(mac, sessionId);
    await mac.agent.flush();

    // Then the window opened in the start folder and the desk is back, woken and waiting, under its old name
    expect(order).toMatchObject({ status: "done" });
    expect(mac.terminal.opened).toHaveLength(1);
    expect(readFileSync(mac.terminal.opened[0], "utf8")).toContain(
      `cd '${folder}'`,
    );
    const [waiting] = await officeSessions();
    expect(waiting).toMatchObject({
      sessionId,
      kept: "woken",
      waitingAtMac: true,
      deskName: "Fix the login bug",
      cwd: subfolder,
      startedAt: startedAt.toISOString(),
      tags: [{ name: "app", key: "repo-app" }],
    });
  });

  it("wakes a kept employee that is not running, clearing the not-running mark while it waits for Claude Code", async () => {
    // Given a hired employee whose window closed
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac, "Plan the launch");
    mac.fake.trust(folder, true);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await mac.agent.reconcile();
    await running.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);

    // When the owner wakes it
    const order = await wake(mac, sessionId);
    await mac.agent.flush();

    // Then a window opened and the desk waits for Claude Code instead of reading not running
    expect(order).toMatchObject({ status: "done" });
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      kept: "woken",
      deskName: "Plan the launch",
    });
    expect(desk).toMatchObject({ starting: true });
    expect(desk).not.toHaveProperty("waitingAtMac");
    expect(desk).not.toHaveProperty("notRunning");
  });
  it("keeps the wake script while only the old process's dead registry entry exists, and removes it once the new window registers", async () => {
    // Given a session that went home but whose dead registry entry stays on disk
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("app");
    const old = await processes.live();
    mac.fake.addSession({
      sessionId: "00000000-0000-4000-8000-000000000004",
      cwd: folder,
      pid: old.pid,
      procStart: old.procStart,
    });
    await runHook(mac.fake.home, {
      session_id: "00000000-0000-4000-8000-000000000004",
      cwd: folder,
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix it",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await old.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.fake.addTranscript("00000000-0000-4000-8000-000000000004", [
      { type: "user" },
    ]);

    // When the owner wakes it and a reconcile pass runs before the new window has registered
    await wake(mac, "00000000-0000-4000-8000-000000000004");
    await mac.agent.reconcile();

    // Then the script the cold Terminal will run is still there
    expect(existsSync(mac.terminal.opened[0])).toBe(true);

    // When the new window registers with a live process
    const running = await processes.live();
    mac.terminal.startSession("00000000-0000-4000-8000-000000000004", {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await mac.agent.reconcile();

    // Then the script is removed
    expect(existsSync(mac.terminal.opened[0])).toBe(false);
  });
  it("keeps a woken employee's original name when the agent restarted before the wake and the owner then types a new prompt", async () => {
    // Given a went-home employee named from its first message, with that message in its transcript, and an agent restart
    const first = await setUpMac("machine-air", "Air");
    const folder = first.fake.makeFolder("app");
    const sessionId = await wentHome(first, folder);
    first.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Fix the login bug" } },
    ]);
    await first.agent.stop();
    const mac = await setUpMac("machine-air", "Air", { fake: first.fake });

    // When it is woken, its window registers and the owner types something else
    await wake(mac, sessionId);
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await mac.agent.reconcile();
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "UserPromptSubmit",
      prompt: "Now add tests for the parser",
    });
    await mac.agent.flush();

    // Then the desk keeps its original name
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      deskName: "Fix the login bug",
    });
  });

  it("keeps a not-running hired employee's name across an agent restart when it is resumed and prompted again", async () => {
    // Given a hired employee that ran, was prompted, and whose window closed, then an agent restart
    const first = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(first, "Plan the launch");
    first.fake.addTranscript(sessionId, [
      { type: "user", message: { role: "user", content: "Plan the launch" } },
    ]);
    const running = await processes.live();
    first.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await first.agent.reconcile();
    await running.kill();
    await first.agent.reconcile();
    await first.agent.flush();
    await first.agent.stop();
    const mac = await setUpMac("machine-air", "Air", { fake: first.fake });
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When it is resumed elsewhere and the owner types a new prompt
    const again = await processes.live();
    mac.fake.addSession({
      sessionId,
      cwd: folder,
      pid: again.pid,
      procStart: again.procStart,
    });
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "resume",
    });
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "UserPromptSubmit",
      prompt: "Something quite different",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk keeps the name from its first message
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      deskName: "Plan the launch",
    });
  });
});
