import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("an employee moves to the room matching its session", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("follows a turn: idle, thinking, working, needs permission, thinking, idle", async () => {
    // Given a Mac with one interactive session
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });

    /** Sends one event through the real hook and returns the state the office shows. */
    async function send(event: Record<string, unknown>): Promise<string> {
      await runHook(fake.home, {
        session_id: "s1",
        cwd: "/work/app",
        ...event,
      });
      await agent.flush();
      return (await officeSessions())[0]?.state;
    }

    // When the session goes through one turn, the office shows the room after every event
    const states = [
      await send({ hook_event_name: "SessionStart", source: "startup" }),
      await send({ hook_event_name: "UserPromptSubmit", prompt: "fix it" }),
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "b1",
      }),
      await send({ hook_event_name: "PermissionRequest", tool_name: "Bash" }),
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "b1",
      }),
      await send({ hook_event_name: "Stop" }),
    ];

    // Then it was idle, thinking, working, needs permission, thinking, idle
    expect(states).toEqual([
      "idle",
      "thinking",
      "working",
      "needsPermission",
      "thinking",
      "idle",
    ]);
  });

  describe("when a turn ends", () => {
    /** One interactive session on a Mac; `send` runs an event through the real hook and returns the state shown. */
    async function startSession() {
      const { fake, agent } = await setUpMac(
        "machine-air",
        "Quan's MacBook Air",
      );
      fake.addSession({ sessionId: "s1", cwd: "/work/app" });
      async function send(event: Record<string, unknown>): Promise<string> {
        await runHook(fake.home, {
          session_id: "s1",
          cwd: "/work/app",
          ...event,
        });
        await agent.flush();
        return (await officeSessions())[0]?.state;
      }
      await send({ hook_event_name: "SessionStart", source: "startup" });
      await send({ hook_event_name: "UserPromptSubmit", prompt: "fix it" });
      return { send };
    }

    it("moves to Waiting for you when the last answer asks the owner, and to Idle when it does not", async () => {
      // Given a session in the middle of a turn
      const { send } = await startSession();

      // When the turn ends with a question
      const asked = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "I fixed it. Want me to push?",
      });

      // Then it waits for the owner
      expect(asked).toBe("waitingForYou");

      // When the next turn ends with a plain summary
      await send({ hook_event_name: "UserPromptSubmit", prompt: "yes" });
      // A follow-up Stop keeps an earlier question, so idle here proves the prompt reset it
      const plain = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Pushed the branch.",
      });

      // Then it is idle
      expect(plain).toBe("idle");
    });

    it("moves to Waiting for you when the question follows a code block that the hook's text cut in the middle", async () => {
      // Given a session whose last answer is a long code block followed by a question
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}\`\`\`\nWant me to push?`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it waits for the owner
      expect(state).toBe("waitingForYou");
    });

    it("moves to Waiting for you when a code block opened before the cut closes inside the kept text and another block opens after the question", async () => {
      // Given a long code block, then a question, then a second block left open at the end
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}\`\`\`\nWant me to push?\n\`\`\`sh\nnpm test`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it waits for the owner
      expect(state).toBe("waitingForYou");
    });

    it("moves to Idle when the answer ends inside a code block that the hook's text cut, even if the block's last line reads like a question", async () => {
      // Given a session whose last answer is one long unclosed code block ending in a question-like line
      const { send } = await startSession();
      const answer = `\`\`\`js\n${"a = 1;\n".repeat(400)}// Want me to push?`;

      // When the turn ends
      const state = await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: answer,
      });

      // Then it is idle: code is not a question
      expect(state).toBe("idle");
    });

    it("keeps Waiting for you when a Stop-hook follow-up, with or without tools, ends after the question", async () => {
      // Given a session whose turn ended with a question
      const { send } = await startSession();
      await send({
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "Which branch should I use?",
      });

      // When a Stop hook makes it run a follow-up that ends with a plain answer
      const followUp = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "No spec update is needed.",
      });

      // Then it still waits for the owner
      expect(followUp).toBe("waitingForYou");

      // When the follow-up runs a tool before its plain answer
      await send({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_use_id: "r1",
      });
      await send({
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_use_id: "r1",
      });
      const afterTool = await send({
        hook_event_name: "Stop",
        stop_hook_active: true,
        last_assistant_message: "Nothing to update in the spec yet.",
      });

      // Then it still waits for the owner
      expect(afterTool).toBe("waitingForYou");
    });

    it("moves to Idle when the Stop carries no answer text, as an old hook sends", async () => {
      // Given a session in the middle of a turn
      const { send } = await startSession();

      // When the turn ends with a Stop that has no text fields
      const state = await send({ hook_event_name: "Stop" });

      // Then it is idle, never a false badge
      expect(state).toBe("idle");
    });
  });

  describe("time in the current room", () => {
    const T0 = Date.parse("2026-11-09T10:00:00.000Z");

    it("stamps the moment a session enters a room, and keeps the stamp while it stays in the room, a Working-Thinking flip included", async () => {
      // Given a Mac with a fake clock and one session
      let clock = T0;
      const { fake, agent } = await setUpMac(
        "machine-air",
        "Quan's MacBook Air",
        { now: () => clock },
      );
      fake.addSession({ sessionId: "s1", cwd: "/work/app" });

      /** Moves the clock, sends one event through the real hook, and returns the room's stamp the office shows. */
      async function sendAt(
        offsetS: number,
        event: Record<string, unknown>,
      ): Promise<string | undefined> {
        clock = T0 + offsetS * 1000;
        await runHook(fake.home, {
          session_id: "s1",
          cwd: "/work/app",
          ...event,
        });
        await agent.flush();
        return (await officeSessions())[0]?.stateSince;
      }
      const at = (offsetS: number) =>
        new Date(T0 + offsetS * 1000).toISOString();

      // When the session starts idle, thinks, works, asks for permission and finishes
      const stamps = [
        await sendAt(0, { hook_event_name: "SessionStart", source: "startup" }),
        await sendAt(10, {
          hook_event_name: "UserPromptSubmit",
          prompt: "fix it",
        }),
        await sendAt(20, {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_use_id: "b1",
        }),
        await sendAt(30, {
          hook_event_name: "PermissionRequest",
          tool_name: "Bash",
        }),
        await sendAt(35, {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_use_id: "b1",
        }),
        await sendAt(40, { hook_event_name: "Stop" }),
      ];

      // Then each stamp is the moment the room was entered: thinking -> working keeps the time, thinking after the approval restamps
      expect(stamps).toEqual([at(0), at(10), at(10), at(30), at(35), at(40)]);
    });

    it("takes a session already running when the agent starts from the registry's status time, never from now", async () => {
      // Given a session whose registry status changed an hour before the agent starts
      const live = await processes.live();
      const changedAt = T0 - 3_600_000;
      await setUpMac("machine-air", "Quan's MacBook Air", {
        now: () => T0,
        beforeStart: (fake) =>
          fake.addSession({
            sessionId: "run-a",
            cwd: "/work/a",
            pid: live.pid,
            procStart: live.procStart,
            status: "idle",
            statusUpdatedAt: changedAt,
          }),
      });

      // Then the office shows the room entered at that time
      expect((await officeSessions())[0]?.stateSince).toBe(
        new Date(changedAt).toISOString(),
      );
    });

    it("keeps the stored stamp of a session found without a registry status time while it is still in the same room, and restamps it when the room differs", async () => {
      // Given two stored sessions stamped an hour ago, both listed by the registry without a status time
      const live = await processes.live();
      const other = await processes.live();
      const db = await getDb();
      const storedAt = new Date(T0 - 3_600_000);
      for (const [sessionId, state] of [
        ["same-room", "idle"],
        ["other-room", "working"],
      ]) {
        await db.collection("sessions").insertOne({
          machineId: "machine-air",
          machineName: "Quan's MacBook Air",
          sessionId,
          cwd: `/work/${sessionId}`,
          state,
          stateSince: storedAt,
          startedAt: new Date(T0 - 7_200_000),
          changedAt: new Date(),
        });
      }

      // When the agent starts and both read as idle
      await setUpMac("machine-air", "Quan's MacBook Air", {
        now: () => T0,
        beforeStart: (fake) => {
          fake.addSession({
            sessionId: "same-room",
            cwd: "/work/same-room",
            pid: live.pid,
            procStart: live.procStart,
            status: "idle",
            withoutStatusTime: true,
          });
          fake.addSession({
            sessionId: "other-room",
            cwd: "/work/other-room",
            pid: other.pid,
            procStart: other.procStart,
            status: "idle",
            withoutStatusTime: true,
          });
        },
      });

      // Then the one still in its room keeps the stored stamp and the one that moved is stamped now
      const rows = await db.collection("sessions").find({}).toArray();
      expect(
        Object.fromEntries(rows.map((r) => [r.sessionId, r.stateSince])),
      ).toEqual({ "same-room": storedAt, "other-room": new Date(T0) });
    });

    it("stamps a room the registry moved the session to with the registry's status time, not the moment the agent noticed", async () => {
      // Given a live session the hooks announced at T0
      let clock = T0;
      const live = await processes.live();
      const { fake, agent } = await setUpMac(
        "machine-air",
        "Quan's MacBook Air",
        { now: () => clock },
      );
      fake.addSession({
        sessionId: "reg",
        cwd: "/work/reg",
        pid: live.pid,
        procStart: live.procStart,
        status: "idle",
        statusUpdatedAt: T0,
      });
      await runHook(fake.home, {
        hook_event_name: "SessionStart",
        session_id: "reg",
        cwd: "/work/reg",
        source: "startup",
      });
      await agent.flush();

      // When the registry says busy since T0+50s and the agent notices at T0+100s
      fake.updateSession("reg", {
        status: "busy",
        statusUpdatedAt: T0 + 50_000,
      });
      clock = T0 + 100_000;
      await agent.reconcile();
      await agent.flush();

      // Then the office shows the room entered at the registry's time
      const [row] = await officeSessions();
      expect(row?.stateSince).toBe(new Date(T0 + 50_000).toISOString());
    });

    it("stamps the moment a session goes home, both when its hook says so and when the Mac finds its process gone", async () => {
      // Given two sessions, one that ends through its hook and one whose process dies
      let clock = T0;
      const dead = await processes.live();
      const { fake, agent } = await setUpMac(
        "machine-air",
        "Quan's MacBook Air",
        { now: () => clock },
      );
      fake.addSession({ sessionId: "hooked", cwd: "/work/h" });
      fake.addSession({
        sessionId: "died",
        cwd: "/work/d",
        pid: dead.pid,
        procStart: dead.procStart,
      });
      for (const sessionId of ["hooked", "died"]) {
        await runHook(fake.home, {
          hook_event_name: "SessionStart",
          session_id: sessionId,
          cwd: `/work/${sessionId}`,
          source: "startup",
        });
      }
      await agent.flush();

      // When the first ends 100 s later and the second's process dies 200 s later
      clock = T0 + 100_000;
      await runHook(fake.home, {
        hook_event_name: "SessionEnd",
        session_id: "hooked",
        cwd: "/work/h",
        reason: "other",
      });
      await agent.flush();
      clock = T0 + 200_000;
      await dead.kill();
      await agent.reconcile();
      await agent.flush();

      // Then each went-home stamp is the moment it left
      const rows = await (await getDb())
        .collection("sessions")
        .find({})
        .toArray();
      const stamps = Object.fromEntries(
        rows.map((row) => [row.sessionId, row.stateSince]),
      );
      expect(stamps).toEqual({
        hooked: new Date(T0 + 100_000),
        died: new Date(T0 + 200_000),
      });
    });

    it("stamps a stored session that a restarted agent finds gone with the time it ended", async () => {
      // Given a stored session an earlier run left working, that the registry no longer lists
      const db = await getDb();
      await db.collection("sessions").insertOne({
        machineId: "machine-air",
        machineName: "Quan's MacBook Air",
        sessionId: "stale",
        cwd: "/work/stale",
        state: "working",
        stateSince: new Date(T0 - 3_600_000),
        startedAt: new Date(T0 - 7_200_000),
        changedAt: new Date(),
      });

      // When the agent starts
      await setUpMac("machine-air", "Quan's MacBook Air", { now: () => T0 });

      // Then it went home, and its stamp is no longer the hour-old working stamp
      const stored = await db
        .collection("sessions")
        .findOne({ sessionId: "stale" });
      expect(stored?.state).toBe("wentHome");
      expect(stored?.stateSince).toEqual(stored?.endedAt);
    });
  });
});
