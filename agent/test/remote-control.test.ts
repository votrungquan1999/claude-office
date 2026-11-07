import { describe, expect, it } from "vitest";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("Remote Control id reaches the office", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  it("follows the newest event's Remote Control id, clears it when the newest event has none, and gives none to a session that never had one", async () => {
    // Given two sessions on one Mac
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "remote", cwd: "/work/a" });
    fake.addSession({ sessionId: "plain", cwd: "/work/b" });
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

    // When the first reports an id, then a newer id, and the office sees it
    await send("remote", "SessionStart", {
      CLAUDE_CODE_BRIDGE_SESSION_ID: "old-id",
    });
    await send("remote", "UserPromptSubmit", {
      CLAUDE_CODE_BRIDGE_SESSION_ID: "cse_new",
    });
    await send("plain", "SessionStart");
    await agent.flush();
    const connected = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.bridgeSessionId]),
    );

    // And then Remote Control is turned off, so the next event carries no id
    await send("remote", "Stop");
    await agent.flush();
    const off = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.bridgeSessionId]),
    );

    // Then the office knew the newest id while connected and has none afterwards
    expect(connected).toEqual({ remote: "cse_new", plain: undefined });
    expect(off).toEqual({ remote: undefined, plain: undefined });
  });
});
