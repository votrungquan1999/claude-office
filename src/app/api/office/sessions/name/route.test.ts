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
  return new NextRequest("http://localhost:4710/api/office/sessions/name", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("naming an employee", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("sessions").deleteMany({});
    await db.collection("sessions").insertOne({
      machineId: "m1",
      machineName: "Mac",
      sessionId: "s1",
      cwd: "/work",
      deskName: "Fix the login bug",
      state: "idle",
      stateSince: STORED_AT,
      startedAt: STORED_AT,
      changedAt: STORED_AT,
    });
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
  const rename = (name: string) =>
    POST(post({ machineId: "m1", sessionId: "s1", name }, ownerHeaders));

  it("makes the changes answer carry the owner's name beside the automatic one, as a change a polling device receives", async () => {
    // Given a device whose last answer came just before the rename
    const lastAnswer = new Date();

    // When the owner names the employee
    const response = await rename("Login fixer");

    // Then it is accepted
    expect(response.status).toBe(200);

    // And the next poll carries both names
    const { sessions } = await changes(lastAnswer);
    expect(
      sessions.map((session) => [
        session.sessionId,
        session.ownerName,
        session.deskName,
      ]),
    ).toEqual([["s1", "Login fixer", "Fix the login bug"]]);
  });

  it("keeps the name on one trimmed line, and an empty name takes the owner's name away so the automatic one shows again", async () => {
    // When the owner names it with stray spaces and a line break
    await rename("  Login\n  fixer  ");

    // Then the name is stored on one trimmed line
    const stored = () =>
      getDb().then((db) =>
        db.collection("sessions").findOne({ sessionId: "s1" }),
      );
    expect((await stored())?.ownerName).toBe("Login fixer");

    // When the owner saves an empty name, a poll since then carries the change
    const lastAnswer = new Date();
    await rename("   ");

    // Then no owner name is stored or sent, and the automatic name is untouched
    expect(await stored()).not.toHaveProperty("ownerName");
    const { sessions } = await changes(lastAnswer);
    expect(
      sessions.map((session) => [session.ownerName, session.deskName]),
    ).toEqual([[undefined, "Fix the login bug"]]);
  });

  it("refuses a stranger, a malformed or too long name, and an employee that has no row, changing and creating nothing", async () => {
    // When someone without the owner's session asks
    const stranger = await POST(
      post({ machineId: "m1", sessionId: "s1", name: "Hacked" }),
    );

    // Then it is refused
    expect(stranger.status).toBe(401);

    // And the owner's bad bodies are 400, a name of 61 characters among them
    const bodies = [
      { machineId: "m1", sessionId: "s1", name: "x".repeat(61) },
      { machineId: "m1", sessionId: "s1" },
      { machineId: "", sessionId: "s1", name: "Ok" },
      { machineId: "m1", sessionId: "s1", name: 7 },
    ];
    for (const body of bodies) {
      expect((await POST(post(body, ownerHeaders))).status).toBe(400);
    }
    const notJson = new NextRequest(
      "http://localhost:4710/api/office/sessions/name",
      { method: "POST", headers: ownerHeaders, body: "{" },
    );
    expect((await POST(notJson)).status).toBe(400);

    // And a name for an employee with no row is 404 and creates no row
    const missing = await POST(
      post({ machineId: "m1", sessionId: "gone", name: "Ghost" }, ownerHeaders),
    );
    expect(missing.status).toBe(404);
    const rows = await (await getDb()).collection("sessions").find().toArray();
    expect(rows.map((row) => [row.sessionId, row.ownerName])).toEqual([
      ["s1", undefined],
    ]);
  });
});
