import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hireOnto, postWake } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

describe("a window the office opened when the registry cannot be read", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  /** Makes `~/.claude/sessions` unlistable, so no registry entry can be seen. */
  function loseRegistry(mac: Mac) {
    rmSync(join(mac.fake.home, ".claude", "sessions"), { recursive: true });
  }

  /** A session that was prompted and went home, ready to be woken. */
  async function wentHome(mac: Mac, folder: string) {
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
    await send({ hook_event_name: "UserPromptSubmit", prompt: "Fix it" });
    await mac.agent.reconcile();
    await mac.agent.flush();
    await running.kill();
    mac.fake.removeSession(sessionId);
    await mac.agent.reconcile();
    await mac.agent.flush();
    mac.fake.addTranscript(sessionId, [{ type: "user" }]);
    return sessionId;
  }

  it("stops waiting for a hired desk once the window's own hooks arrive", async () => {
    // Given a hire whose window opened and a registry that then becomes unreadable
    const mac = await setUpMac("machine-air", "Air");
    const { folder, sessionId } = await hireOnto(mac);
    expect((await officeSessions())[0]).toMatchObject({ waitingAtMac: true });
    loseRegistry(mac);

    // When Claude Code's SessionStart and first prompt hooks reach the agent
    const send = (event: Record<string, unknown>) =>
      runHook(mac.fake.home, { session_id: sessionId, cwd: folder, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "Hello" });
    await mac.agent.flush();

    // Then the desk is a working desk, no longer waiting at the Mac
    const [desk] = await officeSessions();
    expect(desk).toMatchObject({ sessionId, state: "thinking" });
    expect(desk).not.toHaveProperty("waitingAtMac");
  });

  it("stops waiting for a woken desk when a hook arrives after its window opened", async () => {
    // Given a woken desk whose window opened a minute ago on the Mac's clock, and a registry that is then unreadable
    const mac = await setUpMac("machine-air", "Air", {
      now: () => Date.now() - 60_000,
    });
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    await postWake("machine-air", sessionId);
    await mac.agent.pollCommands();
    loseRegistry(mac);

    // When the new window's SessionStart hook arrives
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "resume",
    });
    await mac.agent.flush();

    // Then it is no longer waiting
    expect((await officeSessions())[0]).not.toHaveProperty("waitingAtMac");
  });

  it("keeps waiting for a woken desk when the hook is older than its window", async () => {
    // Given a woken desk whose window opened an hour from now on the Mac's clock, so any hook is older than it
    const mac = await setUpMac("machine-air", "Air", {
      now: () => Date.now() + 3_600_000,
    });
    const folder = mac.fake.makeFolder("app");
    const sessionId = await wentHome(mac, folder);
    await postWake("machine-air", sessionId);
    await mac.agent.pollCommands();
    loseRegistry(mac);

    // When a straggler hook of the old process arrives
    await runHook(mac.fake.home, {
      session_id: sessionId,
      cwd: folder,
      hook_event_name: "SessionStart",
      source: "resume",
    });
    await mac.agent.flush();

    // Then the desk still waits
    expect((await officeSessions())[0]).toMatchObject({ waitingAtMac: true });
  });
});
