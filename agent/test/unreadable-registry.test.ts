import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hireOnto } from "./hire-order";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

describe("a window the office opened when the registry cannot be read", () => {
  const { setUpMac, officeSessions } = useMacHarness();

  /** Makes `~/.claude/sessions` unlistable, so no registry entry can be seen. */
  function loseRegistry(mac: Mac) {
    rmSync(join(mac.fake.home, ".claude", "sessions"), { recursive: true });
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
});
