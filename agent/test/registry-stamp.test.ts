import { describe, expect, it } from "vitest";
import { listRegistry } from "../registry";
import { SessionTracker } from "../tracker";
import type { SessionDoc, SessionWriter } from "../writer";
import { makeFakeHome } from "./fake-home";

describe("a registry status against the stamps of the hook events", () => {
  function setUp() {
    const fake = makeFakeHome("m-stamp");
    const submitted: SessionDoc[] = [];
    const writer = {
      submit: (doc: SessionDoc) => {
        submitted.push(doc);
      },
      flush: async () => {},
    } as unknown as SessionWriter;
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-stamp",
      machineName: "Stamp Mac",
      reorderMs: 1,
      now: () => 1_000,
      writer,
    });
    fake.addSession({ sessionId: "s1", cwd: "/work" });
    const send = async (event: Record<string, unknown>, hookTs: number) => {
      tracker.ingest({
        session_id: "s1",
        cwd: "/work",
        hookTs,
        ...event,
      });
      await tracker.flush();
    };
    const reconcile = async () => {
      tracker.reconcile(listRegistry(fake.home), () => true);
      await tracker.flush();
    };
    const lastState = () => submitted.at(-1)?.state;
    return { fake, tracker, send, reconcile, lastState };
  }

  it("ignores a registry status stamped between a late event and the newest one", async () => {
    // Given a tool running since T=100, and a late state-changing event stamped T=50 that arrived after it
    const { fake, tracker, send, reconcile, lastState } = setUp();
    await send({ hook_event_name: "SessionStart", source: "startup" }, 10);
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" }, 20);
    await send(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: "t1",
      },
      100,
    );
    await send(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: "other",
      },
      50,
    );

    // When the registry reports idle at T=75, older than the newest event
    fake.updateSession("s1", { status: "idle", statusUpdatedAt: 75 });
    await reconcile();

    // Then the hooks still win and the session is working
    expect(lastState()).toBe("working");
    tracker.stop();
    fake.remove();
  });

  it("lets the hooks keep a state when the registry status is stamped at the same moment as the last event", async () => {
    // Given a session left thinking by an event stamped T=100
    const { fake, tracker, send, reconcile, lastState } = setUp();
    await send({ hook_event_name: "SessionStart", source: "startup" }, 10);
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" }, 100);

    // When the registry says idle at exactly T=100
    fake.updateSession("s1", { status: "idle", statusUpdatedAt: 100 });
    await reconcile();

    // Then the hooks keep thinking
    expect(lastState()).toBe("thinking");

    // And a registry idle one tick later does win
    fake.updateSession("s1", { status: "idle", statusUpdatedAt: 101 });
    await reconcile();
    expect(lastState()).toBe("idle");
    tracker.stop();
    fake.remove();
  });
});
