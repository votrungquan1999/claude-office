import * as childProcess from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRegistryEntry } from "../registry";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

// Counts the agent's own per-process command-line lookups (`ps -ww -p <pid>`); the real `ps` still runs.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

/** Command-line lookups made since the last reset. */
function lookups(): number {
  return vi
    .mocked(childProcess.execFileSync)
    .mock.calls.filter(([, args]) => (args as string[]).includes("-ww")).length;
}

describe("reading Claude Code's registry without a ps call per file", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  beforeEach(() => {
    vi.mocked(childProcess.execFileSync).mockClear();
  });

  it("reconciles over many stale registry files without looking any command line up on its own", async () => {
    // Given a Mac whose registry holds several entries of processes that are gone
    const mac = await setUpMac("machine-air", "Air");
    for (const name of ["a", "b", "c", "d", "e"]) {
      mac.fake.addSession({
        sessionId: `stale-${name}`,
        cwd: `/work/${name}`,
        entrypoint: "claude-vscode",
      });
    }
    vi.mocked(childProcess.execFileSync).mockClear();

    // When the agent reconciles
    await mac.agent.reconcile();

    // Then the one process-table read was enough: no per-file lookup ran
    expect(lookups()).toBe(0);
  });

  it("looks a dead process up once, not on every read of its registry file", async () => {
    // Given a registry entry whose process is gone
    const mac = await setUpMac("machine-air", "Air");
    mac.fake.addSession({
      sessionId: "stale",
      cwd: "/work/stale",
      entrypoint: "claude-vscode",
    });
    vi.mocked(childProcess.execFileSync).mockClear();

    // When a hook-time lookup reads the session three times
    for (let i = 0; i < 3; i += 1) findRegistryEntry(mac.fake.home, "stale");

    // Then the dead process was asked about once
    expect(lookups()).toBe(1);
  });

  it("hides a session whose process was started with -p at hook time, before any reconcile", async () => {
    // Given a live claude-vscode session whose command line is `claude -p`
    const mac = await setUpMac("machine-air", "Air");
    const printRun = await processes.live(["-p", "setInterval(()=>{},1e6)"]);
    mac.fake.addSession({
      sessionId: "inherited",
      cwd: "/work/inherited",
      entrypoint: "claude-vscode",
      pid: printRun.pid,
      procStart: printRun.procStart,
    });

    // When its first hook arrives and nothing has reconciled yet
    await runHook(mac.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "inherited",
      cwd: "/work/inherited",
      source: "startup",
    });
    await mac.agent.flush();

    // Then the office does not show it
    expect(await officeSessions()).toEqual([]);
  });
});
