import { NextRequest } from "next/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/db/mongo";
import { hireResponseSchema } from "@/shared/commands";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest("http://localhost:4710/api/office/hire", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("hiring an employee", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    for (const name of ["commands", "machines", "folders"]) {
      await db.collection(name).deleteMany({});
    }
    await db.collection("machines").insertMany([
      {
        machineId: "mac-up",
        machineName: "Up",
        lastSeenAt: new Date(),
        agentVersion: "0.3.0",
      },
      {
        machineId: "mac-old",
        machineName: "Old",
        lastSeenAt: new Date(),
        agentVersion: "0.2.0",
      },
      { machineId: "mac-blank", machineName: "Blank", lastSeenAt: new Date() },
      {
        machineId: "mac-down",
        machineName: "Down",
        lastSeenAt: new Date(Date.now() - 600_000),
        agentVersion: "0.3.0",
      },
    ]);
    await db.collection("folders").insertMany(
      ["mac-up", "mac-down", "mac-old", "mac-blank"].map((machineId) => ({
        machineId,
        path: "/work/app",
        companyMode: true,
        firstSeenAt: new Date(),
      })),
    );
    await db.collection("folders").insertOne({
      machineId: "mac-up",
      path: "/work/deleted",
      companyMode: true,
      firstSeenAt: new Date(),
      existsOnMac: false,
    });
  });

  const orders = async () =>
    (await getDb()).collection("commands").find({}).toArray();
  const hire = (body: Record<string, unknown>) =>
    POST(
      post(
        {
          machineId: "mac-up",
          folder: "/work/app",
          firstMessage: "Hi",
          ...body,
        },
        ownerHeaders,
      ),
    );

  it("stores one pending order stamped by the database clock and answers with its ids", async () => {
    // When the owner hires into a known folder of an online Mac, with a message that looks like a field path
    const response = await hire({ firstMessage: "  $secret plan  " });

    // Then one pending order holds the text verbatim, indentation included, and expires in about ten minutes
    expect(response.status).toBe(200);
    const { orderId, sessionId } = hireResponseSchema.parse(
      await response.json(),
    );
    const stored = await orders();
    expect(stored).toHaveLength(1);
    const [order] = stored;
    expect(order).toMatchObject({
      _id: orderId,
      machineId: "mac-up",
      kind: "hire",
      status: "pending",
      sessionId,
      folder: "/work/app",
      firstMessage: "  $secret plan  ",
    });
    const lifetime = order.expireAt.getTime() - order.createdAt.getTime();
    expect(lifetime).toBe(600_000);
  });

  it("refuses a stranger, a bad body, an unknown or deleted folder, and a Mac that is offline or has no record, storing nothing", async () => {
    const refusals = [
      [
        await POST(
          post({
            machineId: "mac-up",
            folder: "/work/app",
            firstMessage: "Hi",
          }),
        ),
        401,
      ],
      [await hire({ firstMessage: "   " }), 400],
      [await hire({ folder: "/work/other" }), 400],
      [await hire({ folder: "/work/deleted" }), 400],
      [await hire({ machineId: "mac-down" }), 409],
      [await hire({ machineId: "mac-ghost" }), 409],
      [await hire({ machineId: "mac-old" }), 409],
      [await hire({ machineId: "mac-blank" }), 409],
    ] as const;
    expect(refusals.map(([response]) => response.status)).toEqual(
      refusals.map(([, status]) => status),
    );
    expect(await orders()).toEqual([]);
  });

  it("accepts a message of exactly 100,000 characters and refuses one more with a clear reason, storing nothing", async () => {
    // When the owner hires with a message at the limit and one character over
    const atLimit = await hire({ firstMessage: "a".repeat(100_000) });
    const over = await hire({ firstMessage: "a".repeat(100_001) });

    // Then the first is stored and the second is refused as too long
    expect(atLimit.status).toBe(200);
    expect(over.status).toBe(400);
    expect((await over.json()).error).toBe("message too long");
    expect(await orders()).toHaveLength(1);
  });

  it("tells the owner to update the agent of a Mac that is too old", async () => {
    // When the owner hires on a Mac whose agent is 0.2.0
    const response = await hire({ machineId: "mac-old" });

    // Then the refusal says what to do
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/update this Mac's agent/i);
  });

  describe("with this server's clock an hour ahead", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("stamps the order by the database clock, not this process's", async () => {
      // Given only this process's Date runs an hour ahead (the database does not)
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 3_600_000);
      const processNow = Date.now();
      // The Mac's heartbeat is judged by this process's clock, so keep it fresh there
      await (await getDb())
        .collection("machines")
        .updateOne(
          { machineId: "mac-up" },
          { $set: { lastSeenAt: new Date(processNow) } },
        );

      // When the owner hires
      const response = await hire({});
      expect(response.status).toBe(200);

      // Then the order follows the real clock
      const [order] = await orders();
      expect(processNow - order.createdAt.getTime()).toBeGreaterThan(3_500_000);
      expect(order.expireAt.getTime() - order.createdAt.getTime()).toBe(
        600_000,
      );
    });
  });
});
