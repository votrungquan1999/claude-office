import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listRegistry } from "../registry";
import { type ProcessProbe, SessionTracker } from "../tracker";
import type { SessionDoc, SessionWriter } from "../writer";
import { makeFakeHome } from "./fake-home";
import { hireOnto } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

/**
 * Rewrites a registry file with its pid as text, as a half-changed Claude Code format would leave it.
 * @param home - The fake home.
 * @param pid - The pid the file is named after.
 */
function spoilPid(home: string, pid: number): void {
  const file = join(home, ".claude", "sessions", `${pid}.json`);
  const entry = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...entry, pid: String(pid) }));
}

describe("a running employee resumed in a new process that one check misses", () => {
  it("stays at work when its own ps finds the new process alive although the process seen alive before is gone", async () => {
    // Given a plain session seen alive by a check as pid 100
    const fake = makeFakeHome("m-resumed-misread");
    const published: SessionDoc[] = [];
    const writer = {
      submit: (doc: SessionDoc) => published.push(doc),
      flush: async () => {},
    } as unknown as SessionWriter;
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-resumed-misread",
      machineName: "Resumed Mac",
      reorderMs: 1,
      now: () => 1_000_000_000_000,
      writer,
    });
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: 100,
      procStart: "Mon Nov 16 08:00:00 2026",
    });
    tracker.ingest({
      hook_event_name: "SessionStart",
      session_id: "plain",
      cwd: "/work/plain",
      source: "startup",
      hookTs: 10,
    });
    await tracker.flush();
    const alive = (pids: number[]): ProcessProbe => ({
      tableStart: () => undefined,
      recheck: (process) => ({
        running: process.pid !== undefined && pids.includes(process.pid),
      }),
    });
    tracker.reconcile(listRegistry(fake.home), () => true, alive([100]));

    // When it is resumed in pid 200 without a SessionStart reaching the agent, and one check's table misses pid 200
    fake.removeSession("plain");
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: 200,
      procStart: "Mon Nov 16 09:00:00 2026",
    });
    tracker.reconcile(listRegistry(fake.home), () => false, alive([200]));
    await tracker.flush();

    // Then it is still at work
    const latest = published.filter((doc) => doc.sessionId === "plain").at(-1);
    expect(latest).toMatchObject({ state: "idle" });
    expect(latest).not.toHaveProperty("endedAt");
    tracker.stop();
    fake.remove();
  });
});

describe("a running employee that one periodic check misreads", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("keeps a hired employee and a plain session at work when their registry entries lose their pid for one check", async () => {
    // Given a hired employee and a plain session, both running and seen alive by a check
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId: hired } = await hireOnto(mac);
    const [hiredProcess, plainProcess] = [
      await processes.live(),
      await processes.live(),
    ];
    mac.terminal.startSession(hired, {
      cwd: folder,
      pid: hiredProcess.pid,
      procStart: hiredProcess.procStart,
    });
    mac.fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: plainProcess.pid,
      procStart: plainProcess.procStart,
    });
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: hired,
      cwd: folder,
      source: "startup",
    });
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "plain",
      cwd: "/work/plain",
      source: "startup",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When both registry files lose their pid and the Mac checks its sessions
    spoilPid(mac.fake.home, hiredProcess.pid);
    spoilPid(mac.fake.home, plainProcess.pid);
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then both are still at work: the hired one is not marked Not running and the plain one has not gone home
    const desks = await officeSessions();
    const desk = (sessionId: string) =>
      desks.find((candidate) => candidate.sessionId === sessionId);
    expect(desk(hired)).toMatchObject({ state: "idle", kept: "hired" });
    expect(desk(hired)).not.toHaveProperty("notRunning");
    expect(desk("plain")).toMatchObject({ state: "idle" });
    expect(desk("plain")).not.toHaveProperty("endedAt");
  }, 60_000);

  it("logs one line with the reason for each session a check ends, without its folder or message", async () => {
    // Given a Mac whose agent log is captured, with a session about to die and one whose pid was reused
    const lines: string[] = [];
    const mac = await setUpMac("machine-air", "Quan's MacBook Air", {
      log: (line) => lines.push(line),
    });
    const dying = await processes.live();
    mac.fake.addSession({
      sessionId: "died",
      cwd: "/work/secret-folder",
      pid: dying.pid,
      procStart: dying.procStart,
    });
    mac.fake.addSession({
      sessionId: "reused",
      cwd: "/work/secret-folder",
      pid: process.pid,
      procStart: "Mon Jan  1 00:00:00 2001",
    });
    for (const sessionId of ["died", "reused"]) {
      const send = (event: Record<string, unknown>) =>
        runHook(mac.fake.home, {
          session_id: sessionId,
          cwd: "/work/secret-folder",
          ...event,
        });
      await send({ hook_event_name: "SessionStart", source: "startup" });
      await send({ hook_event_name: "UserPromptSubmit", prompt: "secret ask" });
    }
    await mac.agent.flush();

    // When one process dies and the Mac checks its sessions
    await dying.kill();
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then each ended session has exactly one line naming it and its reason, and no line holds the folder or message
    const about = (sessionId: string) =>
      lines.filter((line) => line.includes(sessionId));
    expect(about("died")).toHaveLength(1);
    expect(about("died")[0]).toContain("gone");
    expect(about("died")[0]).toContain(String(dying.pid));
    expect(about("reused")).toHaveLength(1);
    expect(about("reused")[0]).toContain("pid reused");
    expect(lines.join("\n")).not.toContain("secret");
  }, 60_000);
});

describe("a running employee that a periodic check wrongly ended", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("brings a session sent home back to work at the next check once its own registry entry lists the same live process again", async () => {
    // Given a running session that had a prompt, seen alive by a check
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const live = await processes.live();
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: live.pid,
      procStart: live.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, {
        session_id: "plain",
        cwd: "/work/plain",
        ...event,
      });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({ hook_event_name: "Stop" });
    await agent.reconcile();
    await agent.flush();

    // When for one check its registry file names another session with the same process, which sends it home
    fake.updateSession("plain", { sessionId: "other" });
    await agent.reconcile();
    await agent.flush();
    expect(
      (await officeSessions(new Date(0))).find(
        (desk) => desk.sessionId === "plain",
      ),
    ).toMatchObject({ state: "wentHome" });

    // And the next check finds its own entry back on the same live process
    fake.updateSession("other", { sessionId: "plain" });
    await agent.reconcile();
    await agent.flush();

    // Then it is back at work, with no end time
    const desk = (await officeSessions(new Date(0))).find(
      (candidate) => candidate.sessionId === "plain",
    );
    expect(desk).toMatchObject({ state: "idle" });
    expect(desk).not.toHaveProperty("endedAt");
  }, 60_000);
});

describe("an employee whose Claude really ended", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("stays home or Not running through later checks after its window closed, its pid was reused or its end hook fired while its process is still listed", async () => {
    // Given a hired employee and three plain sessions, all with a prompt and seen alive by a check
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const { folder, sessionId: hired } = await hireOnto(mac);
    const [hiredProcess, closed, ending] = [
      await processes.live(),
      await processes.live(),
      await processes.live(),
    ];
    mac.terminal.startSession(hired, {
      cwd: folder,
      pid: hiredProcess.pid,
      procStart: hiredProcess.procStart,
    });
    mac.fake.addSession({
      sessionId: "closed",
      cwd: "/work/closed",
      pid: closed.pid,
      procStart: closed.procStart,
    });
    mac.fake.addSession({
      sessionId: "ending",
      cwd: "/work/ending",
      pid: ending.pid,
      procStart: ending.procStart,
    });
    mac.fake.addSession({
      sessionId: "reused",
      cwd: "/work/reused",
      pid: process.pid,
      procStart: "Mon Jan  1 00:00:00 2001",
    });
    const sessions = [
      [hired, folder],
      ["closed", "/work/closed"],
      ["ending", "/work/ending"],
      ["reused", "/work/reused"],
    ];
    for (const [sessionId, cwd] of sessions) {
      const send = (event: Record<string, unknown>) =>
        runHook(mac.fake.home, { session_id: sessionId, cwd, ...event });
      await send({ hook_event_name: "SessionStart", source: "startup" });
      await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    }
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When two windows close, one end hook fires while its process is still listed, and the Mac checks three times
    await hiredProcess.kill();
    await closed.kill();
    await runHook(mac.fake.home, {
      session_id: "ending",
      cwd: "/work/ending",
      hook_event_name: "SessionEnd",
      reason: "other",
    });
    await mac.agent.flush();
    for (let check = 0; check < 3; check++) await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the hired one is still Not running and the others are still home
    const desks = await officeSessions(new Date(0));
    const desk = (sessionId: string) =>
      desks.find((candidate) => candidate.sessionId === sessionId);
    expect(desk(hired)).toMatchObject({ kept: "hired", notRunning: true });
    expect(desk("closed")).toMatchObject({ state: "wentHome" });
    expect(desk("ending")).toMatchObject({ state: "wentHome" });
    expect(desk("reused")).toMatchObject({ state: "wentHome" });
  }, 60_000);
});
