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

function changesRequest(
  headers: Headers,
  since?: Date,
  dayStart?: Date,
): NextRequest {
  const url = new URL("http://localhost:4710/api/office/changes");
  if (since) url.searchParams.set("since", since.toISOString());
  if (dayStart) url.searchParams.set("dayStart", dayStart.toISOString());
  return new NextRequest(url, { headers });
}

/** Writes a session straight into the database with a chosen change stamp. */
async function seedSession(
  sessionId: string,
  changedAt: Date,
  state = "idle",
): Promise<void> {
  await (await getDb()).collection("sessions").insertOne({
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/work",
    state,
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

  it("shows a session stored with the old finished-turn state as idle", async () => {
    // Given a session stored before the state was renamed
    await seedSession("legacy", new Date(T0), "waiting");

    // When the owner asks for the changes
    const body = changesResponseSchema.parse(
      await (await GET(changesRequest(ownerHeaders))).json(),
    );

    // Then the session comes back as idle
    expect(body.sessions.map((s) => [s.sessionId, s.state])).toEqual([
      ["legacy", "idle"],
    ]);
  });

  it("sends each repo tag with only its name and key", async () => {
    // Given a stored session whose tag carries a field the browser must not get
    await seedSession("tagged", new Date(T0));
    await (await getDb()).collection("sessions").updateOne(
      { sessionId: "tagged" },
      {
        $set: {
          tags: [{ name: "api", key: "aaaaaaaaaaaa", path: "/Users/q/api" }],
        },
      },
    );

    // When the owner asks for the changes
    const raw = await (await GET(changesRequest(ownerHeaders))).json();

    // Then the tag reads back as name and key alone
    expect(raw.sessions[0].tags).toEqual([
      { name: "api", key: "aaaaaaaaaaaa" },
    ]);
  });

  it("tells the browser which employees the owner keeps at their desks", async () => {
    // Given one kept session and one plain one
    await seedSession("kept-one", new Date(T0));
    await seedSession("plain", new Date(T0));
    await (await getDb())
      .collection("sessions")
      .updateOne({ sessionId: "kept-one" }, { $set: { kept: "hired" } });

    // When the owner asks for the changes
    const body = changesResponseSchema.parse(
      await (await GET(changesRequest(ownerHeaders))).json(),
    );

    // Then only the kept one carries the mark
    expect(body.sessions.map((s) => [s.sessionId, s.kept]).sort()).toEqual([
      ["kept-one", "hired"],
      ["plain", undefined],
    ]);
  });

  it("tells the browser which kept employees are not running", async () => {
    // Given a kept session whose window closed and one still running
    await seedSession("closed", new Date(T0));
    await seedSession("open", new Date(T0));
    await (await getDb())
      .collection("sessions")
      .updateOne(
        { sessionId: "closed" },
        { $set: { kept: "hired", notRunning: true } },
      );

    // When the owner asks for the changes
    const body = changesResponseSchema.parse(
      await (await GET(changesRequest(ownerHeaders))).json(),
    );

    // Then only the closed one carries the flag
    expect(
      body.sessions.map((s) => [s.sessionId, s.notRunning]).sort(),
    ).toEqual([
      ["closed", true],
      ["open", undefined],
    ]);
  });

  it("passes on each Mac's agent version and whether each folder still exists", async () => {
    // Given a Mac that reports a version and a folder the agent found missing
    const db = await getDb();
    await db.collection("machines").deleteMany({});
    await db.collection("folders").deleteMany({});
    await db.collection("machines").insertOne({
      machineId: "m1",
      machineName: "Mac",
      lastSeenAt: new Date(T0),
      agentVersion: "0.3.0",
    });
    await db.collection("folders").insertMany([
      {
        machineId: "m1",
        path: "/gone",
        companyMode: true,
        firstSeenAt: new Date(T0),
        existsOnMac: false,
      },
      {
        machineId: "m1",
        path: "/unchecked",
        companyMode: true,
        firstSeenAt: new Date(T0),
      },
    ]);

    // When the owner asks for the changes
    const body = changesResponseSchema.parse(
      await (await GET(changesRequest(ownerHeaders))).json(),
    );

    // Then both fields arrive, and an unchecked folder carries none
    expect(body.machines[0]?.agentVersion).toBe("0.3.0");
    expect(
      Object.fromEntries(body.folders.map((f) => [f.path, f.existsOnMac])),
    ).toEqual({ "/gone": false, "/unchecked": undefined });
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

  it("on first load returns live sessions plus those that ended since the browser's day start and had a prompt, with their recent steps", async () => {
    // Given a live session, one that ended today, one that ended yesterday, and one that ended today without a prompt
    const dayStart = new Date(T0 - 3_600_000);
    const step = {
      id: "a".repeat(24),
      text: "Read a.ts",
      startedAt: new Date(T0),
      status: "ok",
    };
    const base = {
      machineId: "m1",
      machineName: "Mac",
      cwd: "/work",
      startedAt: new Date(T0 - 86_400_000 * 2),
      changedAt: new Date(T0),
      recentSteps: [step],
    };
    await (await getDb()).collection("sessions").insertMany([
      { ...base, sessionId: "live", state: "working" },
      {
        ...base,
        sessionId: "today",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(T0 - 60_000),
      },
      {
        ...base,
        sessionId: "yesterday",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(dayStart.getTime() - 60_000),
      },
      {
        ...base,
        sessionId: "quiet",
        state: "wentHome",
        hadPrompt: false,
        endedAt: new Date(T0 - 60_000),
      },
    ]);

    // When the browser loads the office, and when it polls for changes
    const first = changesResponseSchema.parse(
      await (
        await GET(changesRequest(ownerHeaders, undefined, dayStart))
      ).json(),
    );
    const poll = changesResponseSchema.parse(
      await (
        await GET(changesRequest(ownerHeaders, new Date(T0 - 1_000)))
      ).json(),
    );

    // Then the first load has the live one and today's prompted departure, and ended ones keep their recent steps
    expect(first.sessions.map((s) => s.sessionId).sort()).toEqual([
      "live",
      "today",
    ]);
    const byId = (body: typeof first, id: string) =>
      body.sessions.find((s) => s.sessionId === id);
    expect(byId(first, "live")?.recentSteps).toHaveLength(1);
    expect(byId(first, "today")?.recentSteps).toHaveLength(1);
    expect(byId(first, "today")?.hadPrompt).toBe(true);
    // And a poll lists every ended one too
    expect(poll.sessions).toHaveLength(4);
    expect(byId(poll, "quiet")?.recentSteps).toHaveLength(1);
  });

  it("lists every Mac's last sign of life on each answer, with the server's time", async () => {
    // Given two Macs on record and nothing else
    const machines = (await getDb()).collection("machines");
    await machines.deleteMany({});
    await machines.insertMany([
      { machineId: "m1", machineName: "Air", lastSeenAt: new Date(T0) },
      {
        machineId: "m2",
        machineName: "Mini",
        lastSeenAt: new Date(T0 - 600_000),
      },
    ]);

    // When the browser polls with a cursor that matches no session
    const body = changesResponseSchema.parse(
      await (
        await GET(changesRequest(ownerHeaders, new Date(T0 + 3_600_000)))
      ).json(),
    );

    // Then both Macs come back, and so does the server's own time
    expect(body.sessions).toEqual([]);
    expect(
      [...body.machines].sort((a, b) => a.machineId.localeCompare(b.machineId)),
    ).toEqual([
      {
        machineId: "m1",
        machineName: "Air",
        lastSeenAt: new Date(T0).toISOString(),
      },
      {
        machineId: "m2",
        machineName: "Mini",
        lastSeenAt: new Date(T0 - 600_000).toISOString(),
      },
    ]);
    expect(Math.abs(Date.parse(body.serverNow) - Date.now())).toBeLessThan(
      10_000,
    );
  });

  it("lists every Mac's folder records on each answer", async () => {
    // Given folder records of two Macs, one with company mode off
    const folders = (await getDb()).collection("folders");
    await folders.deleteMany({});
    await folders.insertMany([
      {
        machineId: "m1",
        path: "/Users/q/personal",
        companyMode: true,
        firstSeenAt: new Date(T0),
      },
      {
        machineId: "m2",
        path: "/Users/q/ubet",
        companyMode: false,
        firstSeenAt: new Date(T0),
      },
    ]);

    // When the browser polls with a cursor that matches no session
    const body = changesResponseSchema.parse(
      await (
        await GET(changesRequest(ownerHeaders, new Date(T0 + 3_600_000)))
      ).json(),
    );

    // Then both records come back without the storage-only fields
    expect(
      [...body.folders].sort((a, b) => a.machineId.localeCompare(b.machineId)),
    ).toEqual([
      { machineId: "m1", path: "/Users/q/personal", companyMode: true },
      { machineId: "m2", path: "/Users/q/ubet", companyMode: false },
    ]);
  });
});
