import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const DAY_START = new Date(Date.now() - 3_600_000);

describe("one-off and SDK-driven runs never show up as employees", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("hides every run with an sdk- entrypoint and shows terminal, VS Code and unlabelled sessions", async () => {
    // Given live sessions started five ways, all with a hook event and a registry entry
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const entrypoints: Array<[string, string | undefined]> = [
      ["print-run", "sdk-cli"],
      ["sdk-ts-run", "sdk-ts"],
      ["sdk-py-run", "sdk-py"],
      ["terminal", "cli"],
      ["vscode", "claude-vscode"],
      ["unlabelled", undefined],
    ];
    for (const [sessionId, entrypoint] of entrypoints) {
      const running = await processes.live();
      mac.fake.addSession({
        sessionId,
        cwd: `/work/${sessionId}`,
        entrypoint,
        pid: running.pid,
        procStart: running.procStart,
      });
      await runHook(mac.fake.home, {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        source: "startup",
      });
    }

    // When the agent reconciles
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then only the terminal, VS Code and unlabelled sessions are in the office
    expect(
      (await officeSessions()).map((session) => session.sessionId).sort(),
    ).toEqual(["terminal", "unlabelled", "vscode"]);
  });

  it("does not seed running sdk- sessions at agent start and sends nothing home for them", async () => {
    // Given live entries for a claude -p run, an SDK program and a terminal session when the agent starts
    const [print, sdk, terminal] = [
      await processes.live(),
      await processes.live(),
      await processes.live(),
    ];

    // When the agent starts
    await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        for (const [sessionId, entrypoint, running] of [
          ["print-run", "sdk-cli", print],
          ["sdk-ts-run", "sdk-ts", sdk],
          ["terminal", "cli", terminal],
        ] as const) {
          fake.addSession({
            sessionId,
            cwd: `/work/${sessionId}`,
            entrypoint,
            pid: running.pid,
            procStart: running.procStart,
          });
        }
      },
    });

    // Then only the terminal session is stored, and no went-home row exists for the others
    expect(
      (await officeSessions()).map((session) => session.sessionId),
    ).toEqual(["terminal"]);
    const db = await getDb();
    expect(await db.collection("sessions").countDocuments()).toBe(1);
  });
  it("keeps a went-home desk home when a claude -p run resumes its conversation", async () => {
    // Given a terminal session that was prompted and then went home
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const folder = mac.fake.makeFolder("app");
    const first = await processes.live();
    mac.fake.addSession({
      sessionId: "s1",
      cwd: folder,
      pid: first.pid,
      procStart: first.procStart,
      name: "Real name",
    });
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: "s1", cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "Fix login" });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await first.kill();
    mac.fake.removeSession("s1");
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions(DAY_START))[0]).toMatchObject({
      state: "wentHome",
    });

    // When a hidden claude -p run resumes the same conversation and its hooks fire
    const printRun = await processes.live();
    mac.fake.addSession({
      sessionId: "s1",
      cwd: "/elsewhere",
      pid: printRun.pid,
      procStart: printRun.procStart,
      entrypoint: "sdk-cli",
      name: "print name",
    });
    await send({ hook_event_name: "SessionStart", source: "resume" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "summarise" });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk is still at home
    expect((await officeSessions(DAY_START))[0]).toMatchObject({
      sessionId: "s1",
      state: "wentHome",
    });
  });

  it("keeps a running desk's name, start folder and Remote Control link when a claude -p run resumes it", async () => {
    // Given a running terminal session with a name, a folder and a Remote Control link
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const folder = mac.fake.makeFolder("app");
    const real = await processes.live();
    mac.fake.addSession({
      sessionId: "s1",
      cwd: folder,
      pid: real.pid,
      procStart: real.procStart,
      name: "Real name",
      bridgeSessionId: "bridge-real",
      startedAt: 1_700_000_000_000,
    });
    await runHook(mac.fake.home, {
      session_id: "s1",
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // When a newer hidden claude -p run of the same conversation registers
    const printRun = await processes.live();
    mac.fake.addSession({
      sessionId: "s1",
      cwd: "/elsewhere",
      pid: printRun.pid,
      procStart: printRun.procStart,
      entrypoint: "sdk-cli",
      name: "print name",
      startedAt: 1_700_000_100_000,
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk keeps what the real session registered
    expect((await officeSessions())[0]).toMatchObject({
      sessionId: "s1",
      deskName: "Real name",
      bridgeSessionId: "bridge-real",
      startCwd: folder,
    });
  });
  it("hides a claude-vscode session whose process was started with -p", async () => {
    // Given a live session registered as claude-vscode (inherited from the parent) whose command line is `claude -p`
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const printRun = await processes.live(["-p", "setInterval(()=>{},1e6)"]);
    mac.fake.addSession({
      sessionId: "inherited",
      cwd: "/work/inherited",
      entrypoint: "claude-vscode",
      pid: printRun.pid,
      procStart: printRun.procStart,
    });
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "inherited",
      cwd: "/work/inherited",
      source: "startup",
    });

    // When the agent reconciles
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the office does not show it
    expect(await officeSessions()).toEqual([]);
  });

  it("hides a claude-vscode session whose process was started with --print", async () => {
    // Given a live interactive-kind session whose command line has the long `--print` flag before any `--`
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const printRun = await processes.live([
      "--print",
      "setInterval(()=>{},1e6)",
    ]);
    mac.fake.addSession({
      sessionId: "inherited-long",
      cwd: "/work/inherited-long",
      entrypoint: "claude-vscode",
      pid: printRun.pid,
      procStart: printRun.procStart,
    });
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "inherited-long",
      cwd: "/work/inherited-long",
      source: "startup",
    });

    // When the agent reconciles
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the office does not show it
    expect(await officeSessions()).toEqual([]);
  });

  it("keeps a session shown when only its first message, after --, contains -p", async () => {
    // Given a live session whose command line has `-p` only in the message after `--`
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    const hired = await processes.live([
      "-e",
      "setInterval(()=>{},1e6)",
      "--",
      "fix",
      "-p",
      "--print",
      "thing",
    ]);
    mac.fake.addSession({
      sessionId: "hired",
      cwd: "/work/hired",
      pid: hired.pid,
      procStart: hired.procStart,
    });
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "hired",
      cwd: "/work/hired",
      source: "startup",
    });

    // When the agent reconciles
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it is shown
    expect((await officeSessions()).map((s) => s.sessionId)).toEqual(["hired"]);
  });
});
