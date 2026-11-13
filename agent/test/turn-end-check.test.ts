import { describe, expect, it, vi } from "vitest";
import { useLiveProcesses } from "./live-process";
import {
  type FakeAnthropicReply,
  type RecordedRequest,
  useMacHarness,
} from "./mac-harness";
import { pause, runHook } from "./run-hook";

const KEY = "sk-test-fake-key";
const ASKING = 'Both fit. Reply "A" or "B", plus any changes you want first.';

/** A Messages API answer whose first text block is `text`. */
function answer(text: string) {
  return {
    status: 200,
    body: { stop_reason: "end_turn", content: [{ type: "text", text }] },
  };
}

/** Answers the desk-name request at once and hands the turn-end check to `check`. */
function fakeHaiku(
  check: () => FakeAnthropicReply | Promise<FakeAnthropicReply>,
) {
  return (request: RecordedRequest) =>
    String(request.body.system).includes("task title")
      ? answer("Plan it")
      : check();
}

describe("a finished turn is checked with Haiku", () => {
  const { setUpMac, officeSessions, startFakeAnthropic } = useMacHarness();
  const processes = useLiveProcesses();

  /** One interactive session in the middle of a turn; `send` runs an event through the real hook. */
  async function startSession(anthropic?: {
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
  }) {
    const { fake, agent } = await setUpMac("machine-air", "Air", { anthropic });
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    /** Sends one event and applies it; with `settle` also waits for the Haiku check. */
    async function send(event: Record<string, unknown>, settle = true) {
      await runHook(fake.home, {
        session_id: "s1",
        cwd: "/work/app",
        ...event,
      });
      await (settle ? agent.flush() : agent.applyEvents());
      return (await officeSessions())[0]?.state;
    }
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "plan it" });
    return { send, agent, officeSessions };
  }

  it("shows Idle at once and then Review when Haiku says the ending reports a result", async () => {
    // Given a key and a Haiku that holds its REPORTS answer until released
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anthropic = await startFakeAnthropic(
      fakeHaiku(() => gate.then(() => answer("REPORTS"))),
    );
    const { send, agent, officeSessions } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
    });

    // When a turn ends with a result and Haiku has not answered yet
    const first = await send(
      {
        hook_event_name: "Stop",
        last_assistant_message: "Done, all tests pass.",
      },
      false,
    );

    // Then the desk shows Idle, not a flash of Review
    expect(first).toBe("idle");

    // When Haiku's answer arrives
    release();
    await agent.flush();

    // Then the desk goes to Review
    expect((await officeSessions())[0]?.state).toBe("review");
  });

  it("shows Waiting for you when Haiku says the ending asks the owner to choose, though no rule matches it", async () => {
    // Given a key and a Haiku that says ASKS
    const anthropic = await startFakeAnthropic(fakeHaiku(() => answer("ASKS")));
    const { send } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
    });

    // When the turn ends with a choice the plain rule does not read as a question
    const state = await send({
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: ASKING,
    });

    // Then the desk waits for the owner
    expect(state).toBe("waitingForYou");
  });

  it("shows Idle for a plain summary when Haiku says NOTHING, and when it overrules a question-mark ending", async () => {
    // Given a Haiku that says NOTHING
    const anthropic = await startFakeAnthropic(
      fakeHaiku(() => answer("NOTHING")),
    );
    const { send } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
    });

    // When the turn ends with a plain summary
    const plain = await send({
      hook_event_name: "Stop",
      last_assistant_message: "Done, all tests pass.",
    });

    // Then it is idle
    expect(plain).toBe("idle");

    // When the next turn ends on a rhetorical question the plain rule reads as a question
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go on" });
    const rhetorical = await send({
      hook_event_name: "Stop",
      last_assistant_message: "All green. Who knew it would be this easy?",
    });

    // Then Haiku's NOTHING wins
    expect(rhetorical).toBe("idle");
  });

  it("uses the plain rule when the owner set no key", async () => {
    // Given an agent with no key
    const { send } = await startSession();

    // When a turn ends with a question, then one with a choice the rule does not read
    const question = await send({
      hook_event_name: "Stop",
      last_assistant_message: "Want me to push?",
    });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "hm" });
    const choice = await send({
      hook_event_name: "Stop",
      last_assistant_message: ASKING,
    });

    // Then the rule decides: Waiting for you for the first, Review for the second
    expect(question).toBe("waitingForYou");
    expect(choice).toBe("review");
  });

  it("shows Idle for a turn that ends with no message when the owner set no key", async () => {
    // Given an agent with no key
    const { send } = await startSession();

    // When a turn ends with an empty message
    const state = await send({
      hook_event_name: "Stop",
      last_assistant_message: "",
    });

    // Then there is nothing to show, so it is Idle
    expect(state).toBe("idle");
  });

  it("keeps Review through a follow-up Stop of the same turn that has nothing to show, while Haiku has not answered it", async () => {
    // Given a key, a Haiku that says REPORTS for the result and never answers the follow-up within the timeout
    const anthropic = await startFakeAnthropic((request) => {
      if (String(request.body.system).includes("task title")) {
        return answer("Plan it");
      }
      const message = (request.body.messages as Array<{ content: string }>)[0];
      return message.content.includes("Done")
        ? answer("REPORTS")
        : new Promise<FakeAnthropicReply>(() => {});
    });
    const { send } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
      timeoutMs: 100,
    });
    expect(
      await send({
        hook_event_name: "Stop",
        last_assistant_message: "Done, all tests pass.",
      }),
    ).toBe("review");

    // When a Stop hook runs another turn that ends with a bare acknowledgement
    const at = await send(
      {
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Ok.",
      },
      false,
    );

    // Then the earlier result stands at once and after Haiku's timeout
    expect(at).toBe("review");
    await pause(300);
    expect((await officeSessions())[0]?.state).toBe("review");
  });

  it("ends in Review when a follow-up Stop arrives before Haiku has answered the first Stop", async () => {
    // Given a key and a Haiku that holds the first answer's REPORTS until released
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anthropic = await startFakeAnthropic((request) => {
      if (String(request.body.system).includes("task title")) {
        return answer("Plan it");
      }
      const message = (request.body.messages as Array<{ content: string }>)[0];
      return message.content.includes("Done")
        ? gate.then(() => answer("REPORTS"))
        : answer("NOTHING");
    });
    const { send, agent, officeSessions } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
    });
    await send(
      {
        hook_event_name: "Stop",
        last_assistant_message: "Done, all tests pass.",
      },
      false,
    );

    // When a Stop hook runs a follow-up turn that ends with nothing to show, then Haiku answers the first Stop
    await send({ hook_event_name: "PreToolUse", tool_name: "Bash" }, false);
    await send({ hook_event_name: "PostToolUse", tool_name: "Bash" }, false);
    await send(
      {
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Spec check passed.",
      },
      false,
    );
    release();
    await agent.flush();

    // Then the report is not lost: the desk ends in Review
    expect((await officeSessions())[0]?.state).toBe("review");
  });

  it("falls back to the plain rule when Haiku does not answer in time: a question waits, a report goes to Review as with no key", async () => {
    // Given a Haiku that never answers within the timeout
    const anthropic = await startFakeAnthropic(
      fakeHaiku(() => new Promise(() => {})),
    );
    const { send } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
      timeoutMs: 100,
    });

    // When a turn ends with a question, then one with a choice the rule does not read
    const question = await send({
      hook_event_name: "Stop",
      last_assistant_message: "Want me to push?",
    });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "hm" });
    const choice = await send({
      hook_event_name: "Stop",
      last_assistant_message: ASKING,
    });

    // Then the question waits and the choice, which the plain rule reads as a report, goes to Review
    expect(question).toBe("waitingForYou");
    expect(choice).toBe("review");
  });

  it("ignores a late Haiku answer once a newer prompt started, even after that turn ended", async () => {
    // Given a Haiku that holds its answer about the choice and answers NOTHING to anything else at once
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anthropic = await startFakeAnthropic((request) => {
      if (String(request.body.system).includes("task title")) {
        return answer("Plan it");
      }
      const message = (request.body.messages as Array<{ content: string }>)[0];
      return message.content.includes("Reply")
        ? gate.then(() => answer("ASKS"))
        : answer("NOTHING");
    });
    const { send, agent } = await startSession({
      baseUrl: anthropic.baseUrl,
      apiKey: KEY,
    });

    // When the turn ends and the desk shows the plain rule's Idle
    const ended = await send(
      { hook_event_name: "Stop", last_assistant_message: ASKING },
      false,
    );
    expect(ended).toBe("idle");

    // And the owner sends a new prompt, whose turn ends with a plain summary Haiku answers NOTHING to
    await send({ hook_event_name: "UserPromptSubmit", prompt: "B" }, false);
    await send(
      {
        hook_event_name: "Stop",
        last_assistant_message: "Done, all tests pass.",
      },
      false,
    );
    await vi.waitFor(() => expect(anthropic.requests).toHaveLength(3));
    await pause(100);

    // When Haiku's answer for the earlier turn arrives
    release();
    await agent.flush();

    // Then the desk is not moved to the earlier turn's answer
    expect((await officeSessions())[0]?.state).toBe("idle");
  });

  it("checks the transcript's last answer when the registry says a turn ended that no hook reported", async () => {
    // Given a Haiku that says ASKS and a running session whose Stop never arrived
    const anthropic = await startFakeAnthropic(fakeHaiku(() => answer("ASKS")));
    const { fake, agent } = await setUpMac("machine-air", "Air", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    const live = await processes.live();
    fake.addSession({
      sessionId: "s1",
      cwd: "/work/app",
      pid: live.pid,
      procStart: live.procStart,
    });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: "/work/app", ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "plan it" });
    await agent.flush();
    fake.addTranscript("s1", [
      { type: "user", message: { content: "plan it" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: ASKING }] },
      },
    ]);

    // When the registry says idle and the Mac checks its sessions
    fake.updateSession("s1", {
      status: "idle",
      statusUpdatedAt: Date.now() + 60_000,
    });
    await agent.reconcile();
    await agent.flush();

    // Then the desk waits for the owner
    expect((await officeSessions())[0]?.state).toBe("waitingForYou");
  }, 60_000);
});
