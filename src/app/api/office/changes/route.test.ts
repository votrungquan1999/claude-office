import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { changesResponseSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { GET } from "./route";

const OWNER = "owner@example.com";
const T0 = Date.parse("2026-11-08T10:00:00.000Z");

function changesRequest(headers: Headers, since?: Date): NextRequest {
  const url = new URL("http://localhost:4710/api/office/changes");
  if (since) url.searchParams.set("since", since.toISOString());
  return new NextRequest(url, { headers });
}

/** Writes a session straight into the database with a chosen change stamp. */
async function seedSession(sessionId: string, changedAt: Date): Promise<void> {
  await (await getDb()).collection("sessions").insertOne({
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/work",
    state: "waiting",
    startedAt: new Date(T0 - 60_000),
    changedAt,
  });
}

describe("the office changes API", () => {
  useTestMongo();

  let ownerHeaders: Headers;

  useTestAuth(OWNER);

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("sessions").deleteMany({});
  });

  it("answers only the owner", async () => {
    // Given a stored session
    await seedSession("s1", new Date(T0));

    // When a signed-out caller and the owner ask
    const signedOut = await GET(changesRequest(new Headers()));
    const owner = await GET(changesRequest(ownerHeaders));

    // Then the signed-out caller gets 401 and no data
    expect(signedOut.status).toBe(401);
    expect(await signedOut.text()).not.toContain("s1");
    expect(owner.status).toBe(200);
  });
  it("returns what changed since the cursor with a 5 s overlap, and keeps the cursor when nothing changed", async () => {
    // Given sessions stamped before, just inside, and well outside the overlap, plus two in the same millisecond
    await seedSession("old", new Date(T0 - 20_000));
    await seedSession("in-overlap", new Date(T0 - 4_000));
    await seedSession("same-ms-a", new Date(T0 + 1_000));
    await seedSession("same-ms-b", new Date(T0 + 1_000));
    const cursor = new Date(T0);

    // When the browser asks since its cursor
    const response = await GET(changesRequest(ownerHeaders, cursor));
    const body = changesResponseSchema.parse(await response.json());

    // Then it gets the overlap and the newer writes, not the old one, and the cursor moves to the newest stamp
    expect(body.sessions.map((session) => session.sessionId).sort()).toEqual([
      "in-overlap",
      "same-ms-a",
      "same-ms-b",
    ]);
    expect(body.cursor).toBe(new Date(T0 + 1_000).toISOString());

    // When nothing changed after a far-future cursor
    const later = new Date(T0 + 3_600_000);
    const quiet = changesResponseSchema.parse(
      await (await GET(changesRequest(ownerHeaders, later))).json(),
    );

    // Then the list is empty and the cursor stays where it was
    expect(quiet.sessions).toEqual([]);
    expect(quiet.cursor).toBe(later.toISOString());
  });
});
