import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

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
