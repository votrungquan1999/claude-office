import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import {
  collectConnectResponseSchema,
  createConnectResponseSchema,
} from "@/shared/connect";
import { sessionHeadersFor, signedCookie } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST as approve } from "./approve/route";
import { POST as collect } from "./collect/route";
import { POST as create } from "./route";

const OWNER = "owner@example.com";

function post(path: string, body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest(`http://localhost:4710${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

async function createCode(hostname = "Quan's MacBook") {
  const response = await create(post("/api/connect", { hostname }));
  return { response, body: await response.json() };
}

describe("connecting a new Mac", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("connectCodes").deleteMany({});
  });

  it("hands the connection to the Mac once, after the owner approves, and never stores it", async () => {
    // Given a Mac asked to connect
    const { response, body } = await createCode();
    const code = createConnectResponseSchema.parse(body);
    expect(response.status).toBe(200);
    expect(code.userCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(code.connectUrl).toBe(
      `http://localhost:4710/connect?code=${code.userCode}`,
    );

    // Then it is pending until approved
    const early = await collect(
      post("/api/connect/collect", { pollSecret: code.pollSecret }),
    );
    expect(early.status).toBe(202);
    expect(await early.json()).toEqual({ status: "pending" });

    // When the owner approves
    const approved = await approve(
      post("/api/connect/approve", { userCode: code.userCode }, ownerHeaders),
    );
    expect(approved.status).toBe(200);

    // Then the Mac collects the connection once
    const first = await collect(
      post("/api/connect/collect", { pollSecret: code.pollSecret }),
    );
    expect(first.status).toBe(200);
    expect(collectConnectResponseSchema.parse(await first.json())).toEqual({
      mongodbUri: process.env.MONGODB_URI,
      mongodbDb: process.env.MONGODB_DB,
    });
    const second = await collect(
      post("/api/connect/collect", { pollSecret: code.pollSecret }),
    );
    expect(second.status).toBe(404);

    // And the database never held the secret or the connection string
    const stored = JSON.stringify(
      await (await getDb()).collection("connectCodes").find().toArray(),
    );
    expect(stored).not.toContain(code.pollSecret);
    expect(stored).not.toContain(process.env.MONGODB_URI ?? "never");
  });

  it("makes a new code usable for ten minutes", async () => {
    // When a Mac asks to connect
    const { response, body } = await createCode();
    expect(response.status).toBe(200);

    // Then the stored code expires ten minutes after it was created
    const stored = await (await getDb())
      .collection("connectCodes")
      .findOne({ userCode: createConnectResponseSchema.parse(body).userCode });
    expect(stored?.expiresAt.getTime() - stored?.createdAt.getTime()).toBe(
      10 * 60_000,
    );
  });

  it("accepts a code typed with spaces, dashes and lower case", async () => {
    // Given a Mac asked to connect
    const code = createConnectResponseSchema.parse((await createCode()).body);
    const typed = `${code.userCode.slice(0, 2)} ${code.userCode.slice(2, 4).toLowerCase()} - ${code.userCode.slice(4)}`;

    // When the owner approves the code as typed
    const approved = await approve(
      post("/api/connect/approve", { userCode: typed }, ownerHeaders),
    );

    // Then it is the same request that gets approved
    expect(approved.status).toBe(200);
    const poll = await collect(
      post("/api/connect/collect", { pollSecret: code.pollSecret }),
    );
    expect(poll.status).toBe(200);
  });

  it("gives the connection to exactly one of two simultaneous collects", async () => {
    // Given an approved request
    const { body } = await createCode();
    const code = createConnectResponseSchema.parse(body);
    await approve(
      post("/api/connect/approve", { userCode: code.userCode }, ownerHeaders),
    );

    // When two polls arrive at the same moment
    const polls = await Promise.all(
      Array.from({ length: 2 }, () =>
        collect(post("/api/connect/collect", { pollSecret: code.pollSecret })),
      ),
    );

    // Then only one receives it
    expect(polls.map((poll) => poll.status).sort()).toEqual([200, 404]);
  });

  it("refuses approval from a signed-out visitor and from a stranger's Google account", async () => {
    // Given a Mac asked to connect
    const code = createConnectResponseSchema.parse((await createCode()).body);
    const strangerId = new ObjectId();
    const db = await getDb();
    await db.collection("user").insertOne({
      _id: strangerId,
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("session").insertOne({
      _id: new ObjectId(),
      token: "stranger-token",
      userId: strangerId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const stranger = new Headers({
      cookie: await signedCookie("stranger-token"),
    });

    // When someone who is not the owner tries to approve
    const attempts = [new Headers(), stranger];
    for (const headers of attempts) {
      const refused = await approve(
        post("/api/connect/approve", { userCode: code.userCode }, headers),
      );
      expect(refused.status).toBe(401);
    }

    // Then the Mac still gets nothing
    const poll = await collect(
      post("/api/connect/collect", { pollSecret: code.pollSecret }),
    );
    expect(poll.status).toBe(202);
  });

  it("refuses an expired code on approve and on collect", async () => {
    // Given one code that expired unapproved and one that expired after approval
    const old = createConnectResponseSchema.parse((await createCode()).body);
    const late = createConnectResponseSchema.parse((await createCode()).body);
    await approve(
      post("/api/connect/approve", { userCode: late.userCode }, ownerHeaders),
    );
    await (await getDb())
      .collection("connectCodes")
      .updateMany(
        { userCode: { $in: [old.userCode, late.userCode] } },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    // Then neither can be approved or collected
    const approveOld = await approve(
      post("/api/connect/approve", { userCode: old.userCode }, ownerHeaders),
    );
    expect(approveOld.status).toBe(404);
    for (const code of [old, late]) {
      const poll = await collect(
        post("/api/connect/collect", { pollSecret: code.pollSecret }),
      );
      expect(poll.status).toBe(404);
    }
  });

  it("refuses a sixth open request, and accepts again once one has expired", async () => {
    // Given five open requests
    for (let i = 0; i < 5; i++) {
      expect((await createCode(`Mac ${i}`)).response.status).toBe(200);
    }

    // Then a sixth is refused
    expect((await createCode("one too many")).response.status).toBe(429);

    // And an expired one no longer counts
    await (await getDb())
      .collection("connectCodes")
      .updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await createCode("after expiry")).response.status).toBe(200);
  });

  it("refuses a request without a usable Mac name", async () => {
    for (const hostname of ["", "   ", "x".repeat(101)]) {
      const { response } = await createCode(hostname);
      expect(response.status).toBe(400);
    }
  });
});
