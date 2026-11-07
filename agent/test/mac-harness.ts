import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema, type SessionDto } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { type RunningAgent, startAgent } from "../start-agent";
import { type FakeHome, makeFakeHome } from "./fake-home";

const OWNER = "owner@example.com";
// Large windows: nothing flushes on its own; each test calls flush() instead of waiting.
const IDLE_MS = 600_000;

export interface MacHarness {
  /** A Mac: a fake home plus its agent running in-process against the test database. */
  setUpMac(
    machineId: string,
    computerName: string,
    options?: { beforeStart?: (fake: FakeHome) => void | Promise<void> },
  ): Promise<{ fake: FakeHome; agent: RunningAgent }>;
  /** What the owner's office API lists right now. */
  officeSessions(): Promise<SessionDto[]>;
}

/**
 * Wires the test database, owner auth and cleanup for a describe block of Mac-side flow tests.
 * @returns Helpers to start Macs and read the office API.
 */
export function useMacHarness(): MacHarness {
  useTestMongo();
  useTestAuth(OWNER);
  const cleanups: Array<() => Promise<void> | void> = [];
  let ownerHeaders: Headers;

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("sessions").deleteMany({});
    await db.collection("machines").deleteMany({});
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  return {
    async setUpMac(machineId, computerName, options) {
      const fake = makeFakeHome(machineId);
      cleanups.push(() => fake.remove());
      // Registry and transcript files that exist before the agent starts.
      await options?.beforeStart?.(fake);
      const agent = await startAgent({
        home: fake.home,
        mongo: {
          uri: process.env.MONGODB_URI ?? "",
          db: process.env.MONGODB_DB ?? "",
        },
        computerName,
        flushMs: IDLE_MS,
        reorderMs: IDLE_MS,
        reconcileMs: IDLE_MS,
        heartbeatMs: IDLE_MS,
        kanbanPollMs: 50,
      });
      cleanups.push(() => agent.stop());
      return { fake, agent };
    },
    async officeSessions() {
      const response = await getChanges(
        new NextRequest("http://localhost:4710/api/office/changes", {
          headers: ownerHeaders,
        }),
      );
      return changesResponseSchema.parse(await response.json()).sessions;
    },
  };
}
