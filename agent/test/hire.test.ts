import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/mongo";
import { postHire } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";

const MESSAGE = "Fix the login bug\nand $HOME -- stay calm";

describe("hiring an employee from the office", () => {
  const { setUpMac, officeSessions, startFakeAnthropic } = useMacHarness();
  const processes = useLiveProcesses();

  /** A Mac that can take orders, with an existing folder it has already shown the office. */
  async function onlineMac(anthropic?: { baseUrl: string; apiKey: string }) {
    const mac = await setUpMac("machine-air", "Quan's MacBook Air", {
      anthropic,
    });
    const folder = mac.fake.makeFolder("app with 'quote");
    const db = await getDb();
    await db.collection("folders").insertOne({
      machineId: "machine-air",
      path: folder,
      companyMode: true,
      firstSeenAt: new Date(),
    });
    return { ...mac, folder };
  }

  it("names a hired employee from its first message and keeps that message as its request", async () => {
    // Given an online keyed Mac and a fake Anthropic
    const anthropic = await startFakeAnthropic(() => ({
      status: 200,
      body: {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Fix login bug" }],
      },
    }));
    const mac = await onlineMac({
      baseUrl: anthropic.baseUrl,
      apiKey: "sk-test-fake-key",
    });

    // When the owner hires and the agent picks the order up
    const { response } = await postHire("machine-air", mac.folder, MESSAGE);
    expect(response.status).toBe(200);
    await mac.agent.pollCommands();
    await mac.agent.flush();

    // Then Haiku was asked once with the message and the desk shows its name and the request
    expect(anthropic.requests).toHaveLength(1);
    expect(JSON.stringify(anthropic.requests[0].body.messages)).toContain(
      "Fix the login bug",
    );
    const [desk] = await officeSessions();
    expect(desk.deskName).toBe("Fix login bug");
    expect(desk.request).toBe(MESSAGE);
  });

  it("opens a Terminal window on the Mac with the message kept out of the script, and the desk appears in that folder once Claude Code starts", async () => {
    // Given an online Mac whose folder exists and which knows the owner's folder
    const mac = await onlineMac();
    const { folder } = mac;
    const db = await getDb();

    // When the owner hires into it and the agent picks the order up
    const { response, body } = await postHire("machine-air", folder, MESSAGE);
    expect(response.status).toBe(200);
    await mac.agent.pollCommands();

    // Then one script was opened inside a private folder, runs claude with Remote Control and the session id, and holds no message text
    expect(mac.terminal.opened).toHaveLength(1);
    const [script] = mac.terminal.opened;
    expect(script).toMatch(/\.command$/);
    expect(statSync(dirname(script)).mode & 0o777).toBe(0o700);
    const text = readFileSync(script, "utf8");
    expect(text.startsWith("#!/bin/zsh\n")).toBe(true);
    expect(text).toContain(`cd '${folder.replaceAll("'", "'\\''")}'`);
    expect(text).toContain(
      `--remote-control --session-id ${body?.sessionId} -- "$msg"`,
    );
    expect(text).not.toContain("Fix the login bug");

    // And the message sits in a private file, and the order no longer holds it
    const messageFile = script.replace(/\.command$/, ".msg");
    expect(readFileSync(messageFile, "utf8")).toBe(MESSAGE);
    expect(statSync(messageFile).mode & 0o777).toBe(0o600);
    const order = await db
      .collection("commands")
      .findOne({ _id: body?.orderId as never });
    expect(order?.status).toBe("done");
    expect(order).not.toHaveProperty("firstMessage");
    expect(order?.expireAt.getTime() - Date.now()).toBeGreaterThan(
      23 * 3_600_000,
    );

    // When Claude Code starts in the window and registers
    const running = await processes.live();
    mac.terminal.startSession(body?.sessionId ?? "", {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the employee's desk is in that folder, marked hired, with its Remote Control link
    const desks = await officeSessions();
    expect(desks).toHaveLength(1);
    expect(desks[0]).toMatchObject({
      sessionId: body?.sessionId,
      startCwd: folder,
      kept: "hired",
      bridgeSessionId: "bridge-hired",
    });
  });

  const sessionIds = new Map<string, string>();
  /** The session id an order row was written with. */
  const sessionOf = (id: string) => sessionIds.get(id) ?? "";

  /** An order row written straight into the database, as the hire route would have; its folder is one the Mac lists unless told otherwise. */
  async function insertOrder(
    fields: Record<string, unknown>,
    options: { listFolder?: boolean } = {},
  ) {
    const id = `order-${Math.random().toString(36).slice(2)}`;
    const row = {
      _id: id as never,
      machineId: "machine-air",
      kind: "hire",
      status: "pending",
      sessionId: randomUUID(),
      folder: "/nowhere",
      firstMessage: "Hello",
      createdAt: new Date(),
      expireAt: new Date(Date.now() + 600_000),
      ...fields,
    };
    sessionIds.set(id, row.sessionId);
    const db = await getDb();
    if (options.listFolder !== false) {
      await db.collection("folders").updateOne(
        { machineId: row.machineId, path: row.folder },
        {
          $setOnInsert: { companyMode: true, firstSeenAt: new Date() },
        },
        { upsert: true },
      );
    }
    await db.collection("commands").insertOne(row);
    return id;
  }
  const orderOf = async (id: string) =>
    (await getDb()).collection("commands").findOne({ _id: id as never });

  it("removes the launch script and message once the hired session's registry entry appears", async () => {
    // Given a hired window that has opened
    const mac = await onlineMac();
    const { body } = await postHire("machine-air", mac.folder, "Hello there");
    await mac.agent.pollCommands();
    const [script] = mac.terminal.opened;
    expect(existsSync(script)).toBe(true);

    // When Claude Code registers the session
    const running = await processes.live();
    mac.terminal.startSession(body?.sessionId ?? "", {
      cwd: mac.folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await mac.agent.reconcile();

    // Then both files are gone
    expect(existsSync(script)).toBe(false);
    expect(existsSync(script.replace(/\.command$/, ".msg"))).toBe(false);
  });

  it("never runs another Mac's order, nor one that waited more than 30 s by the database clock", async () => {
    // Given an order for another Mac and one for this Mac created 31 s ago
    const mac = await onlineMac();
    const other = await insertOrder({
      machineId: "machine-mini",
      folder: mac.folder,
    });
    const stale = await insertOrder({
      folder: mac.folder,
      createdAt: new Date(Date.now() - 31_000),
    });

    // When this Mac polls
    await mac.agent.pollCommands();

    // Then nothing opened and both orders are untouched
    expect(mac.terminal.opened).toEqual([]);
    expect((await orderOf(other))?.status).toBe("pending");
    expect((await orderOf(stale))?.status).toBe("pending");
  });

  it("ends the order failed with a reason when the folder is gone, claude is missing or the window will not open", async () => {
    // Given three orders that each hit a different problem
    const folderless = await setUpMac("machine-air", "Air");
    const missing = await insertOrder({ folder: "/definitely/not/here" });
    await folderless.agent.pollCommands();
    expect((await orderOf(missing))?.reason).toBe("folderMissing");
    expect(folderless.terminal.opened).toEqual([]);
    await folderless.agent.stop();

    const noClaude = await setUpMac("machine-air", "Air", {
      claudePath: "/no/such/claude",
    });
    const folder = noClaude.fake.makeFolder("p");
    const noBinary = await insertOrder({ folder });
    await noClaude.agent.pollCommands();
    expect((await orderOf(noBinary))?.reason).toBe("claudeNotFound");
    expect(noClaude.terminal.opened).toEqual([]);
    await noClaude.agent.stop();

    const broken = await setUpMac("machine-air", "Air", {
      terminalOpener: async () => {
        throw new Error("open refused");
      },
      log: () => {},
    });
    const brokenFolder = broken.fake.makeFolder("q");
    const failing = await insertOrder({ folder: brokenFolder });
    await broken.agent.pollCommands();

    // Then each order says why, and a failed open leaves no launch files behind
    expect(await orderOf(failing)).toMatchObject({
      status: "failed",
      reason: "launchFailed",
    });
    expect(
      existsSync(
        `${broken.fake.home}/.claude-office/launch/${sessionOf(failing)}.msg`,
      ),
    ).toBe(false);
  });

  it("fails an order as launch failed when the Terminal opener hangs, leaves no files and no desk, and still runs the next order", async () => {
    // Given a Terminal opener that never answers the first order but answers the second
    let calls = 0;
    const mac = await setUpMac("machine-air", "Air", {
      openerTimeoutMs: 200,
      log: () => {},
      terminalOpener: () => {
        calls += 1;
        return calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
      },
    });
    const folder = mac.fake.makeFolder("q");
    const hung = await insertOrder({ folder });
    const next = await insertOrder({ folder });

    // When the agent works through both orders
    await mac.agent.pollCommands();

    // Then the first failed as launch failed with no files or desk, and the second was still run
    expect(await orderOf(hung)).toMatchObject({
      status: "failed",
      reason: "launchFailed",
    });
    expect(
      existsSync(
        `${mac.fake.home}/.claude-office/launch/${sessionOf(hung)}.command`,
      ),
    ).toBe(false);
    expect(await orderOf(next)).toMatchObject({ status: "done" });
    expect((await officeSessions()).map((d) => d.sessionId)).toEqual([
      sessionOf(next),
    ]);
  }, 20_000);

  it("fails an order the previous agent run claimed and never finished, without opening anything, and leaves another Mac's alone", async () => {
    // Given a claimed order of this Mac and one of another Mac
    const mine = await insertOrder({ status: "claimed", folder: "/x" });
    const theirs = await insertOrder({
      status: "claimed",
      machineId: "machine-mini",
    });

    // When the agent starts
    const mac = await setUpMac("machine-air", "Air");
    await mac.agent.pollCommands();

    // Then mine failed interrupted, the other is untouched and nothing opened
    expect(await orderOf(mine)).toMatchObject({
      status: "failed",
      reason: "interrupted",
    });
    expect((await orderOf(theirs))?.status).toBe("claimed");
    expect(mac.terminal.opened).toEqual([]);
  });

  it("still tracks a hired session whose window never started, even after the held-session timeout", async () => {
    // Given a hire opened at a clock the test controls
    let clock = Date.now();
    const mac = await setUpMac("machine-air", "Air", { now: () => clock });
    const folder = mac.fake.makeFolder("late");
    const lateSession = randomUUID();
    const id = await insertOrder({ folder, sessionId: lateSession });
    await mac.agent.pollCommands();
    expect((await orderOf(id))?.status).toBe("done");

    // When an hour passes and Claude Code finally starts
    clock += 3_600_000;
    await mac.agent.reconcile();
    const running = await processes.live();
    mac.terminal.startSession(lateSession, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then its desk still appears
    expect((await officeSessions()).map((s) => s.sessionId)).toEqual([
      lateSession,
    ]);
  });

  it("judges an order's freshness by the database clock even when the Mac's own clock is an hour ahead", async () => {
    // Given a Mac whose clock runs an hour ahead, a fresh order and one created 31 s ago
    const mac = await setUpMac("machine-air", "Air", {
      now: () => Date.now() + 3_600_000,
    });
    const folder = mac.fake.makeFolder("skew");
    const fresh = await insertOrder({ folder });
    const stale = await insertOrder({
      folder,
      createdAt: new Date(Date.now() - 31_000),
    });

    // When the Mac polls
    await mac.agent.pollCommands();

    // Then the fresh order ran and the 31 s one was refused
    expect((await orderOf(fresh))?.status).toBe("done");
    expect((await orderOf(stale))?.status).toBe("pending");
    expect(mac.terminal.opened).toHaveLength(1);
  });

  it("judges an order's freshness by the database clock even when Date in the agent process is an hour ahead", async () => {
    // Given the process clock an hour ahead of the database, a fresh order and one created 31 s ago
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("date-skew");
    const realNow = Date.now();
    const fresh = await insertOrder({ folder, createdAt: new Date(realNow) });
    const stale = await insertOrder({
      folder,
      createdAt: new Date(realNow - 31_000),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(realNow + 3_600_000);

    try {
      // When the Mac polls
      await mac.agent.pollCommands();
    } finally {
      vi.useRealTimers();
    }

    // Then the fresh order ran and the 31 s one was refused
    expect((await orderOf(fresh))?.status).toBe("done");
    expect((await orderOf(stale))?.status).toBe("pending");
    expect(mac.terminal.opened).toHaveLength(1);
  });

  it("runs orders one after another in creation order when two polls overlap, never entering the Terminal opener twice at once", async () => {
    // Given two hire orders and a Terminal opener that answers only once released
    let inside = 0;
    let mostInside = 0;
    const opened: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mac = await setUpMac("machine-air", "Air", {
      terminalOpener: async (script) => {
        opened.push(script);
        inside += 1;
        mostInside = Math.max(mostInside, inside);
        await gate;
        inside -= 1;
      },
    });
    const folder = mac.fake.makeFolder("overlap");
    const first = await insertOrder({
      folder,
      createdAt: new Date(Date.now() - 5_000),
    });
    const second = await insertOrder({
      folder,
      createdAt: new Date(Date.now() - 4_000),
    });

    // When both polls start before the opener answers
    const a = mac.agent.pollCommands();
    const b = mac.agent.pollCommands();
    await vi.waitFor(() => expect(opened.length).toBeGreaterThan(0));

    // Then only the older order is inside the opener, and the newer one has not even been claimed
    expect((await orderOf(second))?.status).toBe("pending");
    expect(mostInside).toBe(1);
    expect(opened).toHaveLength(1);
    release();
    await Promise.all([a, b]);

    // And the newer order ran after it
    expect(mostInside).toBe(1);
    expect(opened.map((script) => script.split("/").pop())).toEqual([
      `${sessionOf(first)}.command`,
      `${sessionOf(second)}.command`,
    ]);
    expect((await orderOf(first))?.status).toBe("done");
    expect((await orderOf(second))?.status).toBe("done");
  });

  it("ends a malformed order failed as invalid without running anything, whatever its session id or folder holds", async () => {
    // Given orders written straight into the database with a shell-syntax id, a relative folder, a path-like id and no message
    const mac = await onlineMac();
    const bad = [
      await insertOrder({
        sessionId: "x; touch /tmp/pwn #",
        folder: mac.folder,
      }),
      await insertOrder({ folder: "relative/folder" }),
      await insertOrder({ sessionId: "../../escape", folder: mac.folder }),
      await insertOrder({ firstMessage: undefined, folder: mac.folder }),
    ];

    // When the Mac polls
    await mac.agent.pollCommands();

    // Then each ended failed as invalid, the Terminal opener never ran and no launch file or desk exists
    for (const id of bad) {
      expect(await orderOf(id)).toMatchObject({
        status: "failed",
        reason: "invalidOrder",
      });
    }
    expect(mac.terminal.opened).toEqual([]);
    const launchDir = `${mac.fake.home}/.claude-office/launch`;
    expect(existsSync(launchDir) ? readdirSync(launchDir) : []).toEqual([]);
    expect(await officeSessions()).toEqual([]);
  });

  it("runs only the kinds of order it knows and leaves another kind pending", async () => {
    // Given an order of a kind this agent has never heard of
    const mac = await onlineMac();
    const id = await insertOrder({ kind: "format-disk", folder: mac.folder });

    // When the Mac polls
    await mac.agent.pollCommands();

    // Then it was not even claimed
    expect((await orderOf(id))?.status).toBe("pending");
    expect(mac.terminal.opened).toEqual([]);
  });

  it("refuses a hire into a folder the Mac does not list, even one that exists", async () => {
    // Given an existing folder that is not on the Mac's folder list
    const mac = await onlineMac();
    const unlisted = mac.fake.makeFolder("unlisted");
    const id = await insertOrder({ folder: unlisted }, { listFolder: false });

    // When the Mac polls
    await mac.agent.pollCommands();

    // Then the order failed as invalid and nothing opened
    expect(await orderOf(id)).toMatchObject({
      status: "failed",
      reason: "invalidOrder",
    });
    expect(mac.terminal.opened).toEqual([]);
  });

  it("leaves no desk and no launch files behind when a hire fails", async () => {
    // Given three Macs' worth of failures: missing folder, missing claude, window that will not open
    const cases: Array<{
      reason: string;
      options: Parameters<typeof setUpMac>[2];
      folder: (home: { makeFolder: (name: string) => string }) => string;
    }> = [
      {
        reason: "folderMissing",
        options: {},
        folder: () => "/definitely/not/here",
      },
      {
        reason: "claudeNotFound",
        options: { claudePath: "/no/such/claude" },
        folder: (fake) => fake.makeFolder("a"),
      },
      {
        reason: "launchFailed",
        options: {
          terminalOpener: async () => {
            throw new Error("open refused");
          },
          log: () => {},
        },
        folder: (fake) => fake.makeFolder("b"),
      },
    ];
    for (const failing of cases) {
      const mac = await setUpMac("machine-air", "Air", failing.options);
      const id = await insertOrder({
        folder: failing.folder(mac.fake),
      });

      // When the agent runs the order and later reconciles and flushes
      await mac.agent.pollCommands();
      await mac.agent.reconcile();
      await mac.agent.flush();

      // Then the order failed, no desk or stored session exists, and no launch file is left
      expect((await orderOf(id))?.reason).toBe(failing.reason);
      expect(await officeSessions()).toEqual([]);
      expect(
        await (await getDb()).collection("sessions").countDocuments({}),
      ).toBe(0);
      const launchDir = `${mac.fake.home}/.claude-office/launch`;
      expect(
        existsSync(launchDir)
          ? readdirSync(launchDir).filter((f) => f.startsWith(sessionOf(id)))
          : [],
      ).toEqual([]);
      await mac.agent.stop();
    }
  });
});
