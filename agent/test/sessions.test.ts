import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema, type SessionDto } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { type RunningAgent, startAgent } from "../start-agent";
import { type FakeHome, makeFakeHome } from "./fake-home";
import { pause, runHook, startHook } from "./run-hook";

const OWNER = "owner@example.com";
// Large windows: nothing flushes on its own; each test calls flush() instead of waiting.
const IDLE_MS = 600_000;

describe("running Claude sessions appear in the office", () => {
  useTestMongo();

  const cleanups: Array<() => Promise<void> | void> = [];
  let ownerHeaders: Headers;

  useTestAuth(OWNER);

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("sessions").deleteMany({});
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A Mac: a fake home plus its agent running in-process against the test database. */
  async function setUpMac(machineId: string, computerName: string) {
    const fake: FakeHome = makeFakeHome(machineId);
    cleanups.push(() => fake.remove());
    const agent: RunningAgent = await startAgent({
      home: fake.home,
      mongo: {
        uri: process.env.MONGODB_URI ?? "",
        db: process.env.MONGODB_DB ?? "",
      },
      computerName,
      flushMs: IDLE_MS,
      reorderMs: IDLE_MS,
    });
    cleanups.push(() => agent.stop());
    return { fake, agent };
  }

  async function officeSessions(): Promise<SessionDto[]> {
    const response = await getChanges(
      new NextRequest("http://localhost:4710/api/office/changes", {
        headers: ownerHeaders,
      }),
    );
    return changesResponseSchema.parse(await response.json()).sessions;
  }

  it("shows each Mac's session with the machine name and the folder, and the folder follows cd", async () => {
    // Given two Macs, each running one interactive session
    const air = await setUpMac("machine-air", "Quan's MacBook Air");
    const mini = await setUpMac("machine-mini", "Mac mini");
    air.fake.addSession({ sessionId: "air-1", cwd: "/Users/q/api" });
    mini.fake.addSession({ sessionId: "mini-1", cwd: "/Users/q/docs" });

    // When both sessions start and the Air's session later cds into a sub-folder
    await runHook(air.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "air-1",
      cwd: "/Users/q/api",
      source: "startup",
    });
    await runHook(mini.fake.home, {
      hook_event_name: "SessionStart",
      session_id: "mini-1",
      cwd: "/Users/q/docs",
      source: "startup",
    });
    await runHook(air.fake.home, {
      hook_event_name: "PreToolUse",
      session_id: "air-1",
      cwd: "/Users/q/api/web",
      tool_name: "Read",
      tool_use_id: "t1",
    });
    await air.agent.flush();
    await mini.agent.flush();

    // Then the office lists one employee per session with its machine and latest folder
    const sessions = await officeSessions();
    expect(
      sessions
        .map(({ machineName, cwd, sessionId }) => ({
          machineName,
          cwd,
          sessionId,
        }))
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    ).toEqual([
      {
        machineName: "Quan's MacBook Air",
        cwd: "/Users/q/api/web",
        sessionId: "air-1",
      },
      { machineName: "Mac mini", cwd: "/Users/q/docs", sessionId: "mini-1" },
    ]);
  });
  it("keeps the newest folder when events arrive out of order, and an ended session is not revived by a late event", async () => {
    // Given a Mac with one running session
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    mac.fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const home = mac.fake.home;
    await runHook(home, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/work/app",
      source: "startup",
    });

    // When a tool event stamped first reaches the agent after one stamped later
    const slowPre = startHook(home, {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      cwd: "/work/app/old",
      tool_name: "Read",
      tool_use_id: "t1",
    });
    await pause(250);
    await runHook(home, {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/work/app/new",
      tool_name: "Read",
      tool_use_id: "t1",
    });
    // The late event lands in a later batch, so only the cwd guard keeps the newest folder.
    await mac.agent.flush();
    const late = await slowPre.finish();
    expect(late.wallMs).toBeLessThan(1500);
    await mac.agent.flush();

    // Then the folder is the one from the newest event, not the last to arrive
    expect((await officeSessions()).map((session) => session.cwd)).toEqual([
      "/work/app/new",
    ]);

    // When the session ends and a straggler stamped before the end arrives afterwards
    const straggler = startHook(home, {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      cwd: "/work/app/late",
      tool_name: "Read",
      tool_use_id: "t2",
    });
    await pause(250);
    await runHook(home, {
      hook_event_name: "SessionEnd",
      session_id: "s1",
      cwd: "/work/app/new",
      reason: "other",
    });
    await mac.agent.flush();
    expect(await officeSessions()).toEqual([]);
    const delivered = await straggler.finish();
    expect(delivered.wallMs).toBeLessThan(1500);
    await mac.agent.flush();

    // Then the session stays gone
    expect(await officeSessions()).toEqual([]);

    // When the session is resumed
    await runHook(home, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/work/app/new",
      source: "resume",
    });
    await mac.agent.flush();

    // Then the employee comes back
    expect(
      (await officeSessions()).map((session) => session.sessionId),
    ).toEqual(["s1"]);
  });
  it("keeps the main thread's folder when a subagent's events carry another one", async () => {
    // Given a session in its main folder
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    mac.fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const home = mac.fake.home;
    await runHook(home, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/work/app",
      source: "startup",
    });

    // When a subagent working in its own worktree reports a tool
    await runHook(home, {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      agent_id: "sub1",
      cwd: "/tmp/worktrees/sub1",
      tool_name: "Read",
      tool_use_id: "t1",
    });
    await mac.agent.flush();

    // Then the employee still shows the main folder
    expect((await officeSessions()).map((session) => session.cwd)).toEqual([
      "/work/app",
    ]);
  });
  it("shows interactive sessions only, and holds a session until the registry lists it", async () => {
    // Given a headless run and a chat session the registry has not listed yet
    const mac = await setUpMac("machine-air", "Quan's MacBook Air");
    mac.fake.addSession({
      sessionId: "headless",
      cwd: "/work/ci",
      kind: "sdk-cli",
    });
    const home = mac.fake.home;
    for (const sessionId of ["headless", "chat"]) {
      await runHook(home, {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        source: "startup",
      });
    }
    await mac.agent.flush();

    // Then neither appears
    expect(await officeSessions()).toEqual([]);

    // When the registry lists the chat session and it sends its next event
    mac.fake.addSession({ sessionId: "chat", cwd: "/work/chat" });
    await runHook(home, {
      hook_event_name: "UserPromptSubmit",
      session_id: "chat",
      cwd: "/work/chat",
    });
    await mac.agent.flush();

    // Then only the chat session appears
    expect(
      (await officeSessions()).map((session) => session.sessionId),
    ).toEqual(["chat"]);
  });
});
