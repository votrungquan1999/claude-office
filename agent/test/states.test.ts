import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema, type SessionDto } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { startAgent } from "../start-agent";
import { makeFakeHome } from "./fake-home";
import { runHook } from "./run-hook";

const OWNER = "owner@example.com";
// Large windows: nothing flushes on its own; each step calls flush() instead of waiting.
const IDLE_MS = 600_000;

describe("an employee moves to the room matching its session", () => {
  useTestMongo();
  useTestAuth(OWNER);

  const cleanups: Array<() => Promise<void> | void> = [];
  let ownerHeaders: Headers;

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("sessions").deleteMany({});
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function officeSessions(): Promise<SessionDto[]> {
    const response = await getChanges(
      new NextRequest("http://localhost:4710/api/office/changes", {
        headers: ownerHeaders,
      }),
    );
    return changesResponseSchema.parse(await response.json()).sessions;
  }

  it("follows a turn: waiting, thinking, working, needs permission, thinking, waiting", async () => {
    // Given a Mac with one interactive session
    const fake = makeFakeHome("machine-air");
    cleanups.push(() => fake.remove());
    const agent = await startAgent({
      home: fake.home,
      mongo: {
        uri: process.env.MONGODB_URI ?? "",
        db: process.env.MONGODB_DB ?? "",
      },
      computerName: "Quan's MacBook Air",
      flushMs: IDLE_MS,
      reorderMs: IDLE_MS,
    });
    cleanups.push(() => agent.stop());
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

    // Then it was waiting, thinking, working, needs permission, thinking, waiting
    expect(states).toEqual([
      "waiting",
      "thinking",
      "working",
      "needsPermission",
      "thinking",
      "waiting",
    ]);
  });
});
