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
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { GET } from "./route";

const OWNER = "owner@example.com";

describe("reading one order", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("commands").deleteMany({});
  });

  const read = (id: string, headers?: Headers) =>
    GET(
      new NextRequest(`http://localhost:4710/api/office/commands/${id}`, {
        headers,
      }),
      { params: Promise.resolve({ id }) },
    );

  it("tells the owner the status, reason and database-clock age without the message, and 404s a missing order", async () => {
    // Given an order created 40 s ago that is still pending, and one that failed
    const db = await getDb();
    const created = new Date(Date.now() - 40_000);
    await db.collection("commands").insertMany([
      {
        _id: "o1" as never,
        status: "pending",
        firstMessage: "private words",
        createdAt: created,
        expireAt: new Date(Date.now() + 600_000),
      },
      {
        _id: "o2" as never,
        status: "failed",
        reason: "folderMissing",
        createdAt: new Date(),
        expireAt: new Date(Date.now() + 600_000),
      },
    ]);

    // When the owner reads them
    const pending = await read("o1", ownerHeaders);
    const failed = await read("o2", ownerHeaders);

    // Then the age comes from the database clock and the text never appears
    const pendingBody = await pending.json();
    expect(pendingBody.status).toBe("pending");
    expect(pendingBody.ageMs).toBeGreaterThanOrEqual(40_000);
    expect(pendingBody.ageMs).toBeLessThan(60_000);
    expect(JSON.stringify(pendingBody)).not.toContain("private words");
    expect(await failed.json()).toMatchObject({
      status: "failed",
      reason: "folderMissing",
    });

    // And a missing order is a 404 and a signed-out caller a 401
    expect((await read("gone", ownerHeaders)).status).toBe(404);
    expect((await read("o1")).status).toBe(401);
  });

  describe("with this server's clock an hour ahead", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("measures the age by the database clock, not this process's", async () => {
      // Given an order created 5 s ago by the database clock
      await (await getDb()).collection("commands").insertOne({
        _id: "o9" as never,
        status: "claimed",
        createdAt: new Date(Date.now() - 5_000),
        expireAt: new Date(Date.now() + 600_000),
      });

      // When only this process's Date jumps an hour ahead
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 3_600_000);
      const body = await (await read("o9", ownerHeaders)).json();

      // Then the age is still seconds, not an hour
      expect(body.ageMs).toBeGreaterThanOrEqual(5_000);
      expect(body.ageMs).toBeLessThan(60_000);
    });
  });
});
