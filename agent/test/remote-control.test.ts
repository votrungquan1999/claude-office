import { describe, expect, it } from "vitest";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("Remote Control id reaches the office", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("keeps the registry's id through hook events that carry none, takes an id a hook carries, and clears it only when the registry entry drops it", async () => {
    // Given sessions whose registry entries are live, one with a Remote Control id and one without
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const [remote, plain] = [await processes.live(), await processes.live()];
    fake.addSession({
      sessionId: "remote",
      cwd: "/work/remote",
      pid: remote.pid,
      procStart: remote.procStart,
      bridgeSessionId: "cse_registry",
    });
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: plain.pid,
      procStart: plain.procStart,
    });
    const send = (
      sessionId: string,
      event: string,
      env: Record<string, string> = {},
    ) =>
      runHook(
        fake.home,
        {
          hook_event_name: event,
          session_id: sessionId,
          cwd: `/work/${sessionId}`,
        },
        env,
      );
    const bridgeIds = async () =>
      Object.fromEntries(
        (await officeSessions()).map((s) => [s.sessionId, s.bridgeSessionId]),
      );

    // When hook events arrive without the env var
    await send("remote", "SessionStart");
    await send("remote", "UserPromptSubmit");
    await send("remote", "Stop");
    await send("plain", "SessionStart");
    await agent.reconcile();
    await agent.flush();
    const withoutEnv = await bridgeIds();

    // And a hook that does carry an id arrives
    await send("plain", "UserPromptSubmit", {
      CLAUDE_CODE_BRIDGE_SESSION_ID: "cse_from_hook",
    });
    await send("plain", "Stop");
    await agent.flush();
    const fromHook = await bridgeIds();

    // And then the registry entry drops its id
    fake.updateSession("remote", { bridgeSessionId: undefined });
    await agent.reconcile();
    await agent.flush();
    const dropped = await bridgeIds();

    // Then the registry id survived, a hook id was taken, and only the registry dropping it cleared it
    expect(withoutEnv).toEqual({ remote: "cse_registry", plain: undefined });
    expect(fromHook).toEqual({
      remote: "cse_registry",
      plain: "cse_from_hook",
    });
    expect(dropped.remote).toBeUndefined();
  }, 60_000);
});
