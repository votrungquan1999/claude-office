import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { orderResponseSchema } from "@/shared/commands";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest("http://localhost:4710/api/office/dismiss", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("dismissing an employee", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    for (const name of ["commands", "machines", "sessions"]) {
      await db.collection(name).deleteMany({});
    }
    await db.collection("machines").insertOne({
      machineId: "mac-up",
      machineName: "Up",
      lastSeenAt: new Date(),
      agentVersion: "0.3.0",
    });
  });

  const seedSession = (sessionId: string, extra: Record<string, unknown>) =>
    getDb().then((db) =>
      db.collection("sessions").insertOne({
        machineId: "mac-up",
        machineName: "Up",
        sessionId,
        cwd: "/work/app/src",
        startCwd: "/work/app",
        state: "idle",
        startedAt: new Date(),
        changedAt: new Date(),
        ...extra,
      }),
    );
  const orders = async () =>
    (await getDb()).collection("commands").find({}).toArray();
  const dismiss = (body: Record<string, unknown>) =>
    POST(post({ machineId: "mac-up", sessionId: "s1", ...body }, ownerHeaders));

  it("stores one pending dismiss order for a kept session in each state, without any text", async () => {
    // Given kept sessions that are running, not running, waiting at the Mac and starting
    await seedSession("s1", { kept: "hired", state: "thinking" });
    await seedSession("s2", { kept: "woken", notRunning: true });
    await seedSession("s3", {
      kept: "hired",
      state: "needsPermission",
      waitingAtMac: true,
    });
    await seedSession("s4", { kept: "woken", starting: true });

    // When the owner dismisses each
    const answers = [];
    for (const sessionId of ["s1", "s2", "s3", "s4"]) {
      answers.push(await dismiss({ sessionId }));
    }

    // Then each gets one pending dismiss order with a ten-minute expiry and no message
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 200, 200, 200,
    ]);
    const answered = orderResponseSchema.parse(await answers[0].json());
    const stored = await orders();
    expect(stored).toHaveLength(4);
    expect(
      stored.find((order) => order._id === (answered.orderId as never)),
    ).toMatchObject({
      machineId: "mac-up",
      kind: "dismiss",
      status: "pending",
      sessionId: "s1",
    });
    for (const order of stored) {
      expect(order.expireAt.getTime() - order.createdAt.getTime()).toBe(
        600_000,
      );
      expect(order).not.toHaveProperty("firstMessage");
    }
  });

  it("refuses a stranger and a bad body, storing nothing", async () => {
    // Given a kept session
    await seedSession("s1", { kept: "hired" });

    // When a stranger asks, and the owner sends an empty session id
    const stranger = await POST(post({ machineId: "mac-up", sessionId: "s1" }));
    const blank = await dismiss({ sessionId: "" });

    // Then 401 and 400, and no order exists
    expect([stranger.status, blank.status]).toEqual([401, 400]);
    expect(await orders()).toEqual([]);
  });

  it("refuses a Mac that is offline, has no record or runs an old agent, naming the update, storing nothing", async () => {
    // Given a kept session on each kind of Mac that cannot take orders
    const db = await getDb();
    await db.collection("machines").insertMany([
      {
        machineId: "mac-down",
        machineName: "Down",
        lastSeenAt: new Date(Date.now() - 600_000),
        agentVersion: "0.3.0",
      },
      {
        machineId: "mac-old",
        machineName: "Old",
        lastSeenAt: new Date(),
        agentVersion: "0.2.0",
      },
    ]);
    for (const machineId of ["mac-down", "mac-old", "mac-ghost"]) {
      await db.collection("sessions").insertOne({
        machineId,
        machineName: machineId,
        sessionId: "s1",
        cwd: "/work/app",
        kept: "hired",
        state: "idle",
        startedAt: new Date(),
        changedAt: new Date(),
      });
    }

    // When the owner dismisses it on each Mac
    const answers = [
      await dismiss({ machineId: "mac-down" }),
      await dismiss({ machineId: "mac-ghost" }),
      await dismiss({ machineId: "mac-old" }),
    ];

    // Then each is a 409, the old agent's text says to update it, and nothing is stored
    expect(answers.map((answer) => answer.status)).toEqual([409, 409, 409]);
    expect((await answers[2].json()).error).toMatch(/update this Mac's agent/i);
    expect(await orders()).toEqual([]);
  });

  it("refuses a session that is not kept, is unknown, or belongs to another Mac, storing nothing", async () => {
    // Given an ordinary session, and a kept one on another Mac
    await seedSession("plain", { state: "thinking" });
    const db = await getDb();
    await db.collection("machines").insertOne({
      machineId: "mac-other",
      machineName: "Other",
      lastSeenAt: new Date(),
      agentVersion: "0.3.0",
    });
    await db.collection("sessions").insertOne({
      machineId: "mac-other",
      machineName: "Other",
      sessionId: "elsewhere",
      cwd: "/work/app",
      kept: "hired",
      state: "idle",
      startedAt: new Date(),
      changedAt: new Date(),
    });

    // When the owner tries to dismiss each, and one that is not stored at all
    const answers = [
      await dismiss({ sessionId: "plain" }),
      await dismiss({ sessionId: "nobody" }),
      await dismiss({ sessionId: "elsewhere" }),
    ];

    // Then every one is a 400 and nothing is stored
    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400]);
    expect(await orders()).toEqual([]);
  });
});
