import { createServer } from "node:http";
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

/** One request the fake Anthropic server received. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

/** What the fake Anthropic server answers: a status and a JSON body. */
export interface FakeAnthropicReply {
  status: number;
  body: unknown;
}

/** A local stand-in for the Anthropic API, so no test ever reaches the real one. */
export interface FakeAnthropic {
  baseUrl: string;
  requests: RecordedRequest[];
}

export interface MacHarness {
  /** A Mac: a fake home plus its agent running in-process against the test database. */
  setUpMac(
    machineId: string,
    computerName: string,
    options?: {
      beforeStart?: (fake: FakeHome) => void | Promise<void>;
      /** The Mac's clock; real time when absent. */
      now?: () => number;
      /** Points the agent at a fake Anthropic server with this key. */
      anthropic?: { baseUrl: string; apiKey?: string; retryMs?: number };
      /** Restarts an agent on a home that already exists (the harness does not delete it twice). */
      fake?: FakeHome;
      /** Receives the agent's log lines; they go to stderr when absent. */
      log?: (message: string) => void;
    },
  ): Promise<{ fake: FakeHome; agent: RunningAgent }>;
  /** Starts a fake Anthropic server on a free port; `reply` decides each answer. */
  startFakeAnthropic(
    reply: (
      request: RecordedRequest,
      count: number,
    ) => FakeAnthropicReply | Promise<FakeAnthropicReply>,
  ): Promise<FakeAnthropic>;
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
    await db.collection("folders").deleteMany({});
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  return {
    async setUpMac(machineId, computerName, options) {
      const fake = options?.fake ?? makeFakeHome(machineId);
      if (!options?.fake) cleanups.push(() => fake.remove());
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
        now: options?.now,
        anthropicApiKey: options?.anthropic?.apiKey,
        anthropicBaseUrl: options?.anthropic?.baseUrl,
        anthropicRetryMs: options?.anthropic?.retryMs,
        log: options?.log,
      });
      cleanups.push(() => agent.stop());
      return { fake, agent };
    },
    async startFakeAnthropic(reply) {
      const requests: RecordedRequest[] = [];
      const server = createServer((request, response) => {
        let text = "";
        request.on("data", (chunk) => {
          text += chunk;
        });
        request.on("end", async () => {
          const recorded: RecordedRequest = {
            method: request.method ?? "",
            path: request.url ?? "",
            headers: request.headers,
            body: JSON.parse(text || "{}"),
          };
          requests.push(recorded);
          const answer = await reply(recorded, requests.length);
          response.writeHead(answer.status, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(answer.body));
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      cleanups.push(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      );
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return { baseUrl: `http://127.0.0.1:${port}`, requests };
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
