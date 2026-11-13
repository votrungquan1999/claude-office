import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";
const STORED_AT = new Date("2026-11-08T10:00:00.000Z");

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest("http://localhost:4710/api/office/sessions/rank", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("placing conversations in the list", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("sessions").deleteMany({});
    await db.collection("sessions").insertMany(
      ["s1", "s2", "s3"].map((sessionId) => ({
        machineId: "m1",
        machineName: "Mac",
        sessionId,
        cwd: "/work",
        state: "idle",
        startedAt: STORED_AT,
        changedAt: STORED_AT,
      })),
    );
  });

  const changes = async (since?: Date) => {
    const url = new URL("http://localhost:4710/api/office/changes");
    if (since) url.searchParams.set("since", since.toISOString());
    return changesResponseSchema.parse(
      await (
        await getChanges(new NextRequest(url, { headers: ownerHeaders }))
      ).json(),
    );
  };
  const item = (sessionId: string, rank: string) => ({
    machineId: "m1",
    sessionId,
    rank,
  });

  it("stores every place in one request as a change a polling device receives, counts the rows it wrote, and writes nothing for a conversation that has no row", async () => {
    // Given a device whose last answer came just before the move
    const lastAnswer = new Date();

    // When the owner places two conversations and one that does not exist
    const response = await POST(
      post(
        { items: [item("s1", "n"), item("s3", "t"), item("ghost", "b")] },
        ownerHeaders,
      ),
    );

    // Then two rows were written
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ written: 2 });

    // And the next poll carries both places, and no row exists for the unknown one
    const { sessions } = await changes(lastAnswer);
    expect(
      sessions.map((session) => [session.sessionId, session.rank]).sort(),
    ).toEqual([
      ["s1", "n"],
      ["s3", "t"],
    ]);
    const db = await getDb();
    expect(await db.collection("sessions").countDocuments({})).toBe(3);
  });

  it("stores a first drag that places more than 200 unranked rows in one request", async () => {
    // Given a company of 250 live rows with no places yet
    const db = await getDb();
    await db.collection("sessions").deleteMany({});
    await db.collection("sessions").insertMany(
      Array.from({ length: 250 }, (_, i) => ({
        machineId: "m1",
        machineName: "Mac",
        sessionId: `r${i}`,
        cwd: "/work",
        state: "idle",
        startedAt: STORED_AT,
        changedAt: STORED_AT,
      })),
    );

    // When the owner's first drag places all of them in one request
    const response = await POST(
      post(
        { items: Array.from({ length: 250 }, (_, i) => item(`r${i}`, "n")) },
        ownerHeaders,
      ),
    );

    // Then every row is stored
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ written: 250 });
  });

  it("answers only the owner, and refuses a malformed list, a duplicate row, a place with odd characters and an empty list", async () => {
    // Given a valid body
    const valid = { items: [item("s1", "n")] };

    // Then a request with no session is refused and nothing is stored
    expect((await POST(post(valid))).status).toBe(401);
    const db = await getDb();
    expect(await db.collection("sessions").countDocuments({ rank: "n" })).toBe(
      0,
    );

    // And the owner's bad bodies are refused with a 400
    for (const bad of [
      null,
      { items: [] },
      { items: [item("s1", "n"), item("s1", "t")] },
      { items: [item("s1", "N1")] },
      { items: [item("s1", "na")] },
      { items: [item("s1", "n".repeat(65))] },
      { items: Array.from({ length: 5001 }, (_, i) => item(`s${i}`, "n")) },
    ]) {
      expect((await POST(post(bad, ownerHeaders))).status).toBe(400);
    }
    expect(
      await db
        .collection("sessions")
        .countDocuments({ rank: { $exists: true } }),
    ).toBe(0);
  });
});
