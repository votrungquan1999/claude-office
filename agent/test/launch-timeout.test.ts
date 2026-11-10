import { describe, expect, it } from "vitest";
import { hireOnto } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const MINUTE = 60_000;

describe("a window the office opened that never starts Claude Code", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** A Mac whose clock the test moves by hand. */
  function clock() {
    let now = Date.now();
    return {
      now: () => now,
      advance(ms: number) {
        now += ms;
      },
    };
  }

  it("shows Not running after 30 minutes with no registry entry or hook, and not before", async () => {
    // Given a hire whose window opened and never registered
    const time = clock();
    const mac = await setUpMac("machine-air", "Air", { now: time.now });
    const { sessionId } = await hireOnto(mac);

    // When 29 minutes pass
    time.advance(29 * MINUTE);
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it still waits
    expect((await officeSessions())[0]).toMatchObject({ waitingAtMac: true });

    // When it passes 30 minutes
    time.advance(2 * MINUTE);
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk is Not running, kept, and no longer waiting
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      kept: "hired",
      notRunning: true,
      state: "idle",
    });
    expect(desk).not.toHaveProperty("waitingAtMac");
  });

  it("goes back to running when its registry entry appears after it gave up", async () => {
    // Given a hire that gave up after 31 minutes
    const time = clock();
    const mac = await setUpMac("machine-air", "Air", { now: time.now });
    const { folder, sessionId } = await hireOnto(mac);
    time.advance(31 * MINUTE);
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When Claude Code finally starts in the window
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-late",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then the desk is running with its link
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({
      sessionId,
      kept: "hired",
      bridgeSessionId: "bridge-late",
    });
    expect(desk).not.toHaveProperty("notRunning");
  });

  it("goes back to running when a hook arrives after it gave up", async () => {
    // Given a hire that gave up after 31 minutes
    const time = clock();
    const mac = await setUpMac("machine-air", "Air", { now: time.now });
    const { folder, sessionId } = await hireOnto(mac);
    time.advance(31 * MINUTE);
    await mac.agent.reconcile();
    await mac.agent.flush();
    expect((await officeSessions())[0]).toMatchObject({ notRunning: true });

    // When the window's SessionStart hook arrives
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "startup",
    });
    await mac.agent.flush();

    // Then the desk is running again
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId, kept: "hired" });
    expect(desk).not.toHaveProperty("notRunning");
  });

  it("counts the 30 minutes from when the window opened, not from an agent restart", async () => {
    // Given a hire whose window opened 20 minutes before the agent restarted
    const time = clock();
    const mac = await setUpMac("machine-air", "Air", { now: time.now });
    const { sessionId } = await hireOnto(mac);
    time.advance(20 * MINUTE);
    await mac.agent.stop();
    const restarted = await setUpMac("machine-air", "Air", {
      fake: mac.fake,
      now: time.now,
    });
    expect((await officeSessions())[0]).toMatchObject({ waitingAtMac: true });

    // When 15 more minutes pass, which is 35 since the window opened but only 15 since the restart
    time.advance(15 * MINUTE);
    await restarted.agent.reconcile();
    await restarted.agent.flush();

    // Then the desk is Not running
    expect((await officeSessions())[0]).toMatchObject({
      sessionId,
      notRunning: true,
    });
  });
});
