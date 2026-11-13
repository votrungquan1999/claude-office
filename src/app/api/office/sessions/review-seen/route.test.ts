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
const REVIEW_SINCE = new Date("2026-11-08T10:00:00.000Z");

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest(
    "http://localhost:4710/api/office/sessions/review-seen",
    { method: "POST", headers: merged, body: JSON.stringify(body) },
  );
}

describe("moving a Review employee to Idle", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("sessions").deleteMany({});
    await db.collection("machines").deleteMany({});
    // The Mac last spoke ten minutes ago, so it counts as offline
    await db.collection("machines").insertOne({
      machineId: "m1",
      machineName: "Mac",
      lastSeenAt: new Date(Date.now() - 600_000),
    });
    await db.collection("sessions").insertOne({
      machineId: "m1",
      machineName: "Mac",
      sessionId: "s1",
      cwd: "/work",
      state: "review",
      stateSince: REVIEW_SINCE,
      startedAt: new Date(REVIEW_SINCE.getTime() - 60_000),
      changedAt: REVIEW_SINCE,
    });
  });

  const changes = async (since?: Date) =>
    changesResponseSchema.parse(
      await (await getChanges(changesRequest(since))).json(),
    );
  const changesRequest = (since?: Date) => {
    const url = new URL("http://localhost:4710/api/office/changes");
    if (since) url.searchParams.set("since", since.toISOString());
    return new NextRequest(url, { headers: ownerHeaders });
  };
  const moveToIdle = (stateSince: Date) =>
    POST(
      post(
        {
          items: [
            {
              machineId: "m1",
              sessionId: "s1",
              stateSince: stateSince.toISOString(),
            },
          ],
        },
        ownerHeaders,
      ),
    );

  it("makes the changes answer show the employee as Idle, timed from the move, while its Mac is offline", async () => {
    // When the owner moves the Review they saw to Idle
    const before = Date.now() - 1000;
    const response = await POST(
      post(
        {
          items: [
            {
              machineId: "m1",
              sessionId: "s1",
              stateSince: REVIEW_SINCE.toISOString(),
            },
          ],
        },
        ownerHeaders,
      ),
    );

    // Then one employee was marked
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marked: 1 });

    // And every device now reads Idle, counting from the move rather than from the Review
    const [session] = (await changes()).sessions;
    expect(session.state).toBe("idle");
    expect(Date.parse(session.stateSince ?? "")).toBeGreaterThanOrEqual(before);
  });

  it("reaches a device that is already polling, as a change since its last answer", async () => {
    // Given a device whose last answer came just before the move
    const lastAnswer = new Date();

    // When the owner moves the Review to Idle
    await moveToIdle(REVIEW_SINCE);

    // Then that device's next poll carries the employee as Idle
    const { sessions } = await changes(lastAnswer);
    expect(
      sessions.map((session) => [session.sessionId, session.state]),
    ).toEqual([["s1", "idle"]]);
  });

  it("shows a later Review of the same employee as Review again, with its own time", async () => {
    // Given the owner moved a Review to Idle
    await moveToIdle(REVIEW_SINCE);

    // When the agent publishes a new Review of the same conversation
    const laterReview = new Date(REVIEW_SINCE.getTime() + 3_600_000);
    await (await getDb())
      .collection("sessions")
      .updateOne(
        { machineId: "m1", sessionId: "s1" },
        { $set: { stateSince: laterReview, changedAt: new Date() } },
      );

    // Then the changes answer shows Review, timed from the new one
    const [session] = (await changes()).sessions;
    expect([session.state, session.stateSince]).toEqual([
      "review",
      laterReview.toISOString(),
    ]);
  });

  it("marks nothing for a Review the employee already left, or a different Review than the one the owner saw", async () => {
    // Given a second employee that is working
    await (await getDb()).collection("sessions").insertOne({
      machineId: "m1",
      machineName: "Mac",
      sessionId: "s2",
      cwd: "/work",
      state: "working",
      stateSince: REVIEW_SINCE,
      startedAt: REVIEW_SINCE,
      changedAt: REVIEW_SINCE,
    });

    // When the owner moves the working one, and an earlier Review of the first one
    const response = await POST(
      post(
        {
          items: [
            {
              machineId: "m1",
              sessionId: "s2",
              stateSince: REVIEW_SINCE.toISOString(),
            },
            {
              machineId: "m1",
              sessionId: "s1",
              stateSince: new Date(REVIEW_SINCE.getTime() - 1000).toISOString(),
            },
          ],
        },
        ownerHeaders,
      ),
    );

    // Then neither was marked and both keep their state
    expect(await response.json()).toEqual({ marked: 0 });
    const states = (await changes()).sessions.map((session) => [
      session.sessionId,
      session.state,
    ]);
    expect(states.sort()).toEqual([
      ["s1", "review"],
      ["s2", "working"],
    ]);
  });

  it("refuses a caller that is not the owner, and a body that names nothing or is malformed, and marks nothing", async () => {
    const item = {
      machineId: "m1",
      sessionId: "s1",
      stateSince: REVIEW_SINCE.toISOString(),
    };

    // When someone without the owner's session asks
    const stranger = await POST(post({ items: [item] }));

    // Then it is refused
    expect(stranger.status).toBe(401);

    // And the owner's empty, oversized or malformed bodies are 400
    const bodies = [
      { items: [] },
      { items: Array.from({ length: 201 }, () => item) },
      { items: [{ ...item, stateSince: "yesterday" }] },
      { items: "s1" },
    ];
    for (const body of bodies) {
      expect((await POST(post(body, ownerHeaders))).status).toBe(400);
    }
    const notJson = new NextRequest(
      "http://localhost:4710/api/office/sessions/review-seen",
      { method: "POST", headers: ownerHeaders, body: "{" },
    );
    expect((await POST(notJson)).status).toBe(400);

    // And the Review was never marked
    expect((await changes()).sessions[0].state).toBe("review");
  });
});
