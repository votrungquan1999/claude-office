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
});
