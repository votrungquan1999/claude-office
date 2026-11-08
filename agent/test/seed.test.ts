import { BSON } from "mongodb";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";

/** A shell command that must never reach the database, plain and as it looks inside JSON text. */
const SENTINEL = '$SECRET_transcript_5c1d\n"x"';
const SENTINEL_FORMS = [SENTINEL, JSON.stringify(SENTINEL).slice(1, -1)];

const STARTED_AT = Date.parse("2026-11-08T07:30:00.000Z");

function user(text: string | Array<{ type: string; text: string }>, more = {}) {
  return {
    type: "user",
    cwd: "/work/a",
    isSidechain: false,
    message: { role: "user", content: text },
    ...more,
  };
}

describe("an agent that starts while sessions are already running", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("shows the running interactive sessions with name, folder and Remote Control id from their transcripts, and sends stored sessions the registry no longer lists home", async () => {
    // Given sessions already running when the agent starts: two interactive ones, one non-interactive, one whose process is gone
    const [a, b, c] = [
      await processes.live(),
      await processes.live(),
      await processes.live(),
    ];
    const gone = await processes.dead();
    const db = await getDb();
    // And a session an earlier agent run stored that the registry no longer lists
    await db.collection("sessions").insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      sessionId: "stale-1",
      cwd: "/work/stale",
      state: "working",
      startedAt: new Date(STARTED_AT - 3_600_000),
      changedAt: new Date(),
    });
    // The seeded session's transcript is long, with a misleading folder in the middle
    const middle = Array.from({ length: 3000 }, () => ({
      type: "assistant",
      cwd: "/middle/stale",
      message: { content: "x".repeat(200) },
    }));

    // When the agent starts
    await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        fake.addSession({
          sessionId: "run-a",
          cwd: "/work/a",
          name: "registry-name-a",
          pid: a.pid,
          procStart: a.procStart,
          status: "busy",
          startedAt: STARTED_AT,
        });
        fake.addSession({
          sessionId: "run-b",
          cwd: "/work/b",
          name: "registry-name-b",
          pid: b.pid,
          procStart: b.procStart,
          status: "waiting",
        });
        fake.addSession({
          sessionId: "run-c",
          cwd: "/work/c",
          kind: "sdk",
          pid: c.pid,
          procStart: c.procStart,
        });
        fake.addSession({
          sessionId: "run-gone",
          cwd: "/work/gone",
          pid: gone.pid,
          procStart: gone.procStart,
        });
        fake.addTranscript("run-a", [
          { type: "bridge-session", bridgeSessionId: "bridge-a" },
          { type: "queue-operation", operation: "enqueue" },
          user("sidechain prompt", { isSidechain: true }),
          // Slash-command and skill-injected turns are not the owner's task description
          user("<command-name>/x</command-name>"),
          user("Base directory for this skill: /skills/x", { isMeta: true }),
          user([
            { type: "text", text: "<ide_opened_file>x.ts</ide_opened_file>" },
            { type: "text", text: "Fix the login bug" },
          ]),
          {
            type: "assistant",
            cwd: "/work/a",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Bash",
                  input: { command: SENTINEL, description: "Run tests" },
                },
              ],
            },
          },
          ...middle,
          user("later prompt", { cwd: "/work/a/sub" }),
        ]);
      },
    });

    // Then the two interactive sessions are in the office with what the transcript knew
    const sessions = (await officeSessions()).sort((x, y) =>
      x.sessionId.localeCompare(y.sessionId),
    );
    expect(sessions.map((s) => s.sessionId)).toEqual(["run-a", "run-b"]);
    const [seededA, seededB] = sessions;
    expect(seededA).toMatchObject({
      machineName: "Quan's MacBook Air",
      cwd: "/work/a/sub",
      deskName: "Fix the login bug",
      bridgeSessionId: "bridge-a",
      state: "thinking",
      startedAt: new Date(STARTED_AT).toISOString(),
      hadPrompt: true,
    });
    // And the one without a transcript falls back to its registry folder and name
    expect(seededB).toMatchObject({
      cwd: "/work/b",
      deskName: "registry-name-b",
      state: "needsPermission",
    });

    // And the stored session nobody lists any more has gone home
    const stale = await db
      .collection("sessions")
      .findOne({ sessionId: "stale-1" });
    expect(stale?.state).toBe("wentHome");
    expect(stale?.endedAt).toBeInstanceOf(Date);

    // And neither command text nor the registry secret reached the database
    const dump: string[] = [];
    for (const { name } of await db.listCollections().toArray()) {
      const docs = await db.collection(name).find({}).toArray();
      dump.push(BSON.EJSON.stringify(docs), JSON.stringify(docs));
    }
    for (const forbidden of [...SENTINEL_FORMS, "REGISTRY_KEY_SECRET_9d2e"]) {
      expect(dump.join("\n")).not.toContain(forbidden);
    }
  }, 60_000);

  it("dates the end of a session found dead after the Mac was off by the last time the Mac was seen alive", async () => {
    // Given a stored session of a Mac that was last seen alive 20 hours ago
    const db = await getDb();
    const lastSeenAt = new Date(Date.now() - 20 * 3_600_000);
    await db.collection("machines").insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      lastSeenAt,
    });
    await db.collection("sessions").insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      sessionId: "overnight",
      cwd: "/work/overnight",
      state: "working",
      startedAt: new Date(lastSeenAt.getTime() - 3_600_000),
      changedAt: new Date(lastSeenAt),
      hadPrompt: true,
    });

    // When the Mac starts again and its agent finds the session gone
    await setUpMac("machine-air", "Quan's MacBook Air");

    // Then it ended when the Mac was last seen, and expires a week after that
    const stored = await db
      .collection("sessions")
      .findOne({ sessionId: "overnight" });
    expect(stored?.state).toBe("wentHome");
    expect(stored?.endedAt).toEqual(lastSeenAt);
    expect(stored?.expireAt).toEqual(
      new Date(lastSeenAt.getTime() + 7 * 86_400_000),
    );
  }, 60_000);

  it("shows a session that had already finished when the agent started in Waiting for you or Idle, read from its transcript tail, and keeps it after the first registry check", async () => {
    // Given a transcript line for each kind of record a finished turn leaves behind
    const text = (words: string) => ({
      type: "assistant",
      cwd: "/work/a",
      message: { content: [{ type: "text", text: words }] },
    });
    const summary = (hasOutput: boolean) => ({
      type: "system",
      subtype: "stop_hook_summary",
      hasOutput,
    });
    const stopHook = {
      type: "attachment",
      attachment: { type: "hook_success", hookEvent: "Stop" },
    };
    const thinking = {
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "..." }] },
    };
    const toolCall = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
      },
    };
    const toolResult = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
    };
    /** A turn ended by a Stop hook that made the session add a follow-up. */
    const withFollowUp = (first: string, second: string) => [
      user("do it"),
      text(first),
      stopHook,
      summary(true),
      thinking,
      text(second),
      summary(false),
    ];
    const transcripts: Record<string, Array<object | string>> = {
      "asked-then-plain-follow-up": withFollowUp(
        "Done. Want me to push?",
        "No spec update needed.",
      ),
      "plain-then-asking-follow-up": withFollowUp(
        "Done.",
        "Should I update the spec?",
      ),
      "plain-ending": [user("do it"), text("All done."), summary(false)],
      garbled: ["{not json", "also not json"],
      "oversized-last-record": [
        user("do it"),
        text("Want me to push?"),
        text(`${"x".repeat(100_000)} All done.`),
      ],
      "asked-then-interrupted": [
        user("do it"),
        text("Want me to push?"),
        user("[Request interrupted by user]"),
      ],
      "asked-but-busy": [user("do it"), text("Want me to push?")],
      "asked-no-hooks": [user("do it"), text("Want me to push?")],
      "asked-then-tool": [user("do it"), text("Want me to push?"), toolCall],
      "asked-then-tool-result": [
        user("do it"),
        text("Want me to push?"),
        toolCall,
        toolResult,
      ],
      "asked-then-background-turn-without-question": [
        user("do it"),
        text("Should I merge it?"),
        summary(false),
        user("<task-notification>done</task-notification>", {
          origin: { kind: "task-notification" },
        }),
        text("Build finished."),
        summary(false),
      ],
      "asked-then-api-error": [
        user("do it"),
        text("Want me to push?"),
        { ...text("API Error: 529"), isApiErrorMessage: true },
      ],
    };
    const ids = Object.keys(transcripts);
    const live = await Promise.all(ids.map(() => processes.live()));

    // When the agent starts with each of them registered, all idle except the busy one
    const { agent } = await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        for (const [index, sessionId] of ids.entries()) {
          fake.addSession({
            sessionId,
            cwd: "/work/a",
            pid: live[index].pid,
            procStart: live[index].procStart,
            status: sessionId === "asked-but-busy" ? "busy" : "idle",
          });
          fake.addTranscript(sessionId, transcripts[sessionId]);
        }
      },
    });
    const states = async () =>
      Object.fromEntries(
        (await officeSessions()).map((s) => [s.sessionId, s.state]),
      );
    const expected = {
      "asked-then-plain-follow-up": "waitingForYou",
      "plain-then-asking-follow-up": "waitingForYou",
      "plain-ending": "idle",
      garbled: "idle",
      "oversized-last-record": "idle",
      "asked-then-interrupted": "idle",
      "asked-but-busy": "thinking",
      "asked-no-hooks": "waitingForYou",
      "asked-then-tool": "idle",
      "asked-then-tool-result": "idle",
      "asked-then-background-turn-without-question": "idle",
      "asked-then-api-error": "idle",
    };

    // Then each shows the room its transcript's ending says
    expect(await states()).toEqual(expected);

    // And the first registry check keeps them
    await agent.reconcile();
    await agent.flush();
    expect(await states()).toEqual(expected);
  }, 60_000);
});
