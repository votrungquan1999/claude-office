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
  return new NextRequest("http://localhost:4710/api/office/wake", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("waking an employee", () => {
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
  const wake = (body: Record<string, unknown>) =>
    POST(post({ machineId: "mac-up", sessionId: "s1", ...body }, ownerHeaders));

  it("stores one pending wake order for the session's start folder, for a went-home session and for a not-running one, without the message or any text", async () => {
    // Given a session that went home and a kept one that is not running
    await seedSession("s1", { state: "wentHome", endedAt: new Date() });
    await seedSession("s2", { kept: "hired", notRunning: true });

    // When the owner wakes each
    const first = await wake({ sessionId: "s1" });
    const second = await wake({ sessionId: "s2" });

    // Then each gets one pending wake order carrying the start folder and a ten-minute expiry
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const answered = orderResponseSchema.parse(await first.json());
    const stored = await orders();
    expect(stored).toHaveLength(2);
    expect(
      stored.find((order) => order._id === (answered.orderId as never)),
    ).toMatchObject({
      machineId: "mac-up",
      kind: "wake",
      status: "pending",
      sessionId: "s1",
      folder: "/work/app",
    });
    expect(answered.sessionId).toBe("s1");
    const [order] = stored;
    expect(order.expireAt.getTime() - order.createdAt.getTime()).toBe(600_000);
    expect(order).not.toHaveProperty("firstMessage");
  });

  it("refuses a second wake for a session while an order for it is pending or claimed, storing nothing more", async () => {
    // Given a went-home session with a pending wake order, and another with a claimed one
    await seedSession("s1", { state: "wentHome", endedAt: new Date() });
    await seedSession("s2", { state: "wentHome", endedAt: new Date() });
    expect((await wake({ sessionId: "s1" })).status).toBe(200);
    expect((await wake({ sessionId: "s2" })).status).toBe(200);
    await (await getDb())
      .collection("commands")
      .updateOne({ sessionId: "s2" }, { $set: { status: "claimed" } });

    // When the owner wakes each again
    const again = [
      await wake({ sessionId: "s1" }),
      await wake({ sessionId: "s2" }),
    ];

    // Then each is a 409 naming the wake on its way, and still one order per session exists
    expect(again.map((answer) => answer.status)).toEqual([409, 409]);
    expect((await again[0].json()).error).toBe(
      "a wake for this employee is already on its way",
    );
    expect(await orders()).toHaveLength(2);
  });

  it("accepts a new wake when the earlier pending order is older than the pickup window", async () => {
    // Given a went-home session whose pending wake order was written 31 s ago and never picked up
    await seedSession("s1", { state: "wentHome", endedAt: new Date() });
    await (await getDb()).collection("commands").insertOne({
      _id: "stale-order" as never,
      machineId: "mac-up",
      kind: "wake",
      status: "pending",
      sessionId: "s1",
      folder: "/work/app",
      createdAt: new Date(Date.now() - 31_000),
      expireAt: new Date(Date.now() + 500_000),
    });

    // When the owner wakes it again
    const answer = await wake({});

    // Then a second order is stored
    expect(answer.status).toBe(200);
    expect(await orders()).toHaveLength(2);
  });

  it("refuses a stranger and a bad body, storing nothing", async () => {
    // Given a session that could be woken
    await seedSession("s1", { state: "wentHome", endedAt: new Date() });

    // When a stranger asks, and the owner sends an empty session id
    const stranger = await POST(post({ machineId: "mac-up", sessionId: "s1" }));
    const blank = await wake({ sessionId: "" });

    // Then 401 and 400, and no order exists
    expect([stranger.status, blank.status]).toEqual([401, 400]);
    expect(await orders()).toEqual([]);
  });

  it("refuses a Mac that is offline, has no record or runs an old agent, naming the update, storing nothing", async () => {
    // Given a went-home session on each kind of Mac that cannot take orders
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
        state: "wentHome",
        endedAt: new Date(),
        startedAt: new Date(),
        changedAt: new Date(),
      });
    }

    // When the owner wakes it on each Mac
    const answers = [
      await wake({ machineId: "mac-down" }),
      await wake({ machineId: "mac-ghost" }),
      await wake({ machineId: "mac-old" }),
    ];

    // Then each is a 409, the old agent's text says to update it, and nothing is stored
    expect(answers.map((answer) => answer.status)).toEqual([409, 409, 409]);
    expect((await answers[2].json()).error).toMatch(/update this Mac's agent/i);
    expect(await orders()).toEqual([]);
  });

  it("refuses a session that is running, waiting, starting, unknown, or belongs to another Mac, storing nothing", async () => {
    // Given sessions in each state that cannot be woken, and a went-home one on another Mac
    await seedSession("running", { state: "thinking" });
    await seedSession("waiting", {
      state: "needsPermission",
      kept: "hired",
      waitingAtMac: true,
    });
    await seedSession("starting", {
      state: "idle",
      kept: "hired",
      starting: true,
    });
    await seedSession("idle", { state: "idle" });
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
      state: "wentHome",
      endedAt: new Date(),
      startedAt: new Date(),
      changedAt: new Date(),
    });

    // When the owner tries to wake each
    const answers = [
      await wake({ sessionId: "running" }),
      await wake({ sessionId: "waiting" }),
      await wake({ sessionId: "starting" }),
      await wake({ sessionId: "idle" }),
      await wake({ sessionId: "nobody" }),
      await wake({ sessionId: "elsewhere" }),
    ];

    // Then every one is a 400 and nothing is stored
    expect(answers.map((answer) => answer.status)).toEqual([
      400, 400, 400, 400, 400, 400,
    ]);
    expect(await orders()).toEqual([]);
  });
});
