import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("a session resumed after going home", () => {
  const { setUpMac } = useMacHarness();
  const processes = useLiveProcesses();

  it("stays in the office when a check runs before the new process is listed, and shows no step from before it went home", async () => {
    // Given a session with a tool mid-run whose process died and was sent home
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const first = await processes.live();
    fake.addSession({
      sessionId: "s1",
      cwd: "/work/app",
      pid: first.pid,
      procStart: first.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    const stored = async () => {
      await agent.flush();
      return (await getDb())
        .collection("sessions")
        .findOne({ sessionId: "s1" });
    };
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { description: "Long build" },
    });
    await agent.flush();
    await first.kill();
    await agent.reconcile();
    expect((await stored())?.state).toBe("wentHome");

    // When it is resumed in a new process and a check runs before Claude Code lists that process
    fake.removeSession("s1");
    await send({ hook_event_name: "SessionStart", source: "resume" });
    await agent.flush();
    await agent.reconcile();
    await send({ hook_event_name: "UserPromptSubmit", prompt: "again" });

    // Then it is working again with no leftover running step
    const resumed = await stored();
    expect(resumed?.state).toBe("thinking");
    expect(resumed?.runningSteps).toEqual([]);

    // When the new process is listed and later dies, the session goes home again
    const second = await processes.live();
    fake.addSession({
      sessionId: "s1",
      cwd: "/work/app",
      pid: second.pid,
      procStart: second.procStart,
    });
    await agent.reconcile();
    expect((await stored())?.state).toBe("thinking");
    await second.kill();
    await agent.reconcile();
    expect((await stored())?.state).toBe("wentHome");
  }, 60_000);
});
