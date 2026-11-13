import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema, type SessionDto } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import type { DismissWaits } from "../commands";
import { type RunningAgent, startAgent } from "../start-agent";
import type { TerminalOpener } from "../terminal-launch";
import { type FakeHome, makeFakeHome } from "./fake-home";
import { createFakeTerminal, type FakeTerminal } from "./fake-terminal";

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
      anthropic?: {
        baseUrl: string;
        apiKey?: string;
        retryMs?: number;
        timeoutMs?: number;
      };
      /** Restarts an agent on a home that already exists (the harness does not delete it twice). */
      fake?: FakeHome;
      /** Replaces the recording fake Terminal; the real one is never used in tests. */
      terminalOpener?: TerminalOpener;
      /** How long the Terminal opener may take before an order fails. */
      openerTimeoutMs?: number;
      /** The waits of a dismiss; short by default so a test never sits through a real grace period. */
      dismissWaits?: Partial<DismissWaits>;
      /** The claude binary hires run; a path that exists by default. */
      claudePath?: string;
      /** The version the agent reports; the repo's own version when absent. */
      agentVersion?: string;
      /** Receives the agent's log lines; they go to stderr when absent. */
      log?: (message: string) => void;
    },
  ): Promise<{
    fake: FakeHome;
    agent: RunningAgent;
    /** Records what the agent opened and plays the part of the started Claude Code. */
    terminal: FakeTerminal;
  }>;
  /** Starts a fake Anthropic server on a free port; `reply` decides each answer. */
  startFakeAnthropic(
    reply: (
      request: RecordedRequest,
      count: number,
    ) => FakeAnthropicReply | Promise<FakeAnthropicReply>,
  ): Promise<FakeAnthropic>;
  /** What the owner's office API lists right now; with `dayStart`, also the departures since then. */
  officeSessions(dayStart?: Date): Promise<SessionDto[]>;
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
    await db.collection("commands").deleteMany({});
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
      const terminal = createFakeTerminal(fake);
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
        commandPollMs: IDLE_MS,
        agentVersion: options?.agentVersion,
        terminalOpener: options?.terminalOpener ?? terminal.open,
        openerTimeoutMs: options?.openerTimeoutMs,
        claudePath: options?.claudePath ?? process.execPath,
        terminalControl: terminal.control,
        processTable: terminal.readProcessTable,
        // A test opener that writes no terminal record is given up on quickly.
        windowRecordMs: 200,
        dismissWaits: {
          termGraceMs: 300,
          childGraceMs: 300,
          busyLimitMs: 600,
          controlLimitMs: 200,
          pollMs: 20,
          ...options?.dismissWaits,
        },
        kanbanPollMs: 50,
        now: options?.now,
        anthropicApiKey: options?.anthropic?.apiKey,
        anthropicBaseUrl: options?.anthropic?.baseUrl,
        anthropicRetryMs: options?.anthropic?.retryMs,
        anthropicTimeoutMs: options?.anthropic?.timeoutMs,
        log: options?.log,
      });
      cleanups.push(() => agent.stop());
      return { fake, agent, terminal };
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
    async officeSessions(dayStart) {
      const url = new URL("http://localhost:4710/api/office/changes");
      if (dayStart) url.searchParams.set("dayStart", dayStart.toISOString());
      const response = await getChanges(
        new NextRequest(url, { headers: ownerHeaders }),
      );
      return changesResponseSchema.parse(await response.json()).sessions;
    },
  };
}
