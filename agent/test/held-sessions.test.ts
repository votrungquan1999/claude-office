import { describe, expect, it } from "vitest";
import { SessionTracker } from "../tracker";
import type { SessionWriter, StepDoc } from "../writer";
import { makeFakeHome } from "./fake-home";

const MINUTE = 60_000;

describe("sessions the agent holds without writing", () => {
  function setUp() {
    const fake = makeFakeHome("m-held");
    let clock = 1_000_000_000_000;
    const submitted: Array<{ sessionId: string; steps: StepDoc[] }> = [];
    const writer = {
      submit: (doc: { sessionId: string }, steps: StepDoc[] = []) => {
        submitted.push({ sessionId: doc.sessionId, steps });
      },
      flush: async () => {},
    } as unknown as SessionWriter;
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-held",
      machineName: "Held Mac",
      reorderMs: 1,
      now: () => clock,
      writer,
    });
    /** One finished Read step for the session. */
    const toolPair = (sessionId: string, n: number) => {
      const base = { session_id: sessionId, cwd: "/work", tool_name: "Read" };
      tracker.ingest({
        ...base,
        hook_event_name: "PreToolUse",
        tool_use_id: `t${n}`,
        hookTs: clock + n * 2,
      });
      tracker.ingest({
        ...base,
        hook_event_name: "PostToolUse",
        tool_use_id: `t${n}`,
        hookTs: clock + n * 2 + 1,
      });
    };
    return {
      fake,
      tracker,
      submitted,
      toolPair,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("keeps at most the newest 500 finished steps while a session waits for its registry entry", async () => {
    // Given a session with 600 finished steps and no registry entry yet
    const { fake, tracker, submitted, toolPair } = setUp();
    for (let n = 0; n < 600; n++) toolPair("waiting", n);
    await tracker.flush();
    expect(submitted).toEqual([]);

    // When its interactive registry entry appears and the next pass runs
    fake.addSession({ sessionId: "waiting", cwd: "/work" });
    tracker.reconcile([], () => true);

    // Then the session is written with the newest 500 steps only
    const written = submitted.flatMap((entry) => entry.steps);
    expect(written).toHaveLength(500);
    tracker.stop();
    fake.remove();
  });

  it("forgets a session with no registry entry after ten quiet minutes", async () => {
    // Given a session with three finished steps and no registry entry
    const { fake, tracker, submitted, toolPair, advance } = setUp();
    for (let n = 0; n < 3; n++) toolPair("quiet", n);
    await tracker.flush();

    // When eleven minutes pass, a pass runs, and then the session turns up interactive and reports one step
    advance(11 * MINUTE);
    tracker.reconcile([], () => true);
    fake.addSession({ sessionId: "quiet", cwd: "/work" });
    toolPair("quiet", 100);
    await tracker.flush();

    // Then only the new step was written; the forgotten ones are gone
    const written = submitted.flatMap((entry) => entry.steps);
    expect(written).toHaveLength(1);
    tracker.stop();
    fake.remove();
  });

  it("forgets a session the registry lists as non-interactive", async () => {
    // Given a headless session with finished steps
    const { fake, tracker, submitted, toolPair } = setUp();
    fake.addSession({ sessionId: "headless", cwd: "/work", kind: "sdk-cli" });
    for (let n = 0; n < 3; n++) toolPair("headless", n);
    await tracker.flush();

    // When a pass runs and later the same id is listed interactive and reports one step
    tracker.reconcile([], () => true);
    fake.updateSession("headless", { kind: "interactive" });
    toolPair("headless", 100);
    await tracker.flush();

    // Then only the new step was written
    expect(submitted.flatMap((entry) => entry.steps)).toHaveLength(1);
    tracker.stop();
    fake.remove();
  });
});
