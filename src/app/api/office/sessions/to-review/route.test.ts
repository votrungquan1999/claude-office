import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getChanges } from "@/app/api/office/changes/route";
import { POST as moveToIdle } from "@/app/api/office/sessions/review-seen/route";
import { getDb } from "@/db/mongo";
import { changesResponseSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";
const IDLE_SINCE = new Date("2026-11-08T10:00:00.000Z");

function post(path: string, body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest(`http://localhost:4710/api/office/sessions/${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("moving an Idle employee to Review", () => {
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
      state: "idle",
      stateSince: IDLE_SINCE,
      startedAt: new Date(IDLE_SINCE.getTime() - 60_000),
      changedAt: IDLE_SINCE,
    });
  });

  const changes = async () =>
    changesResponseSchema.parse(
      await (
        await getChanges(
          new NextRequest("http://localhost:4710/api/office/changes", {
            headers: ownerHeaders,
          }),
        )
      ).json(),
    );
  const shown = async () => {
    const [session] = (await changes()).sessions;
    return [session.state, session.stateSince];
  };
  const toReview = (stateSince: string, sessionId = "s1") =>
    POST(
      post(
        "to-review",
        { machineId: "m1", sessionId, stateSince },
        ownerHeaders,
      ),
    );
  const toIdle = (stateSince: string) =>
    moveToIdle(
      post(
        "review-seen",
        { items: [{ machineId: "m1", sessionId: "s1", stateSince }] },
        ownerHeaders,
      ),
    );

  it("makes the changes answer show the Idle employee as Review, timed from when its turn ended", async () => {
    // When the owner moves the Idle employee they saw to Review
    const response = await toReview(IDLE_SINCE.toISOString());

    // Then one employee was marked
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marked: 1 });

    // And every device now reads Review, still counting from the end of its turn
    expect(await shown()).toEqual(["review", IDLE_SINCE.toISOString()]);
  });

  it("reaches a device that is already polling, as a change since its last answer", async () => {
    // Given a device whose last answer came just before the move
    const lastAnswer = new Date();

    // When the owner moves the Idle employee to Review
    await toReview(IDLE_SINCE.toISOString());

    // Then that device's next poll carries the employee as Review
    const url = new URL("http://localhost:4710/api/office/changes");
    url.searchParams.set("since", lastAnswer.toISOString());
    const { sessions } = changesResponseSchema.parse(
      await (
        await getChanges(new NextRequest(url, { headers: ownerHeaders }))
      ).json(),
    );
    expect(
      sessions.map((session) => [session.sessionId, session.state]),
    ).toEqual([["s1", "review"]]);
  });

  it("lets Move to Idle take a raised Review back to its Idle, and a second raise bring it back", async () => {
    // Given the owner moved the Idle employee to Review
    await toReview(IDLE_SINCE.toISOString());

    // When the owner moves that Review to Idle
    const cleared = await toIdle(IDLE_SINCE.toISOString());

    // Then it is the same Idle again, with its own time
    expect(await cleared.json()).toEqual({ marked: 1 });
    expect(await shown()).toEqual(["idle", IDLE_SINCE.toISOString()]);

    // And moving it to Review once more shows Review again
    expect(await (await toReview(IDLE_SINCE.toISOString())).json()).toEqual({
      marked: 1,
    });
    expect(await shown()).toEqual(["review", IDLE_SINCE.toISOString()]);
  });

  it("ends the move when the employee starts working, so the turn after it sorts itself again", async () => {
    // Given the owner moved the Idle employee to Review
    await toReview(IDLE_SINCE.toISOString());
    const publish = (state: string, stateSince: Date) =>
      getDb().then((db) =>
        db
          .collection("sessions")
          .updateOne(
            { sessionId: "s1" },
            { $set: { state, stateSince, changedAt: new Date() } },
          ),
      );

    // When it starts working, then that turn ends Idle
    const working = new Date(IDLE_SINCE.getTime() + 60_000);
    await publish("working", working);
    const workingShown = await shown();
    const idleAgain = new Date(IDLE_SINCE.getTime() + 120_000);
    await publish("idle", idleAgain);

    // Then it shows Working, then the new Idle
    expect(workingShown).toEqual(["working", working.toISOString()]);
    expect(await shown()).toEqual(["idle", idleAgain.toISOString()]);
  });

  it("marks nothing for an employee in another state, an Idle other than the one the owner saw, one that went home, or one that has no row", async () => {
    // Given employees that are working, in Review and gone home
    await (await getDb()).collection("sessions").insertMany(
      ["working", "review", "wentHome"].map((state) => ({
        machineId: "m1",
        machineName: "Mac",
        sessionId: state,
        cwd: "/work",
        state,
        stateSince: IDLE_SINCE,
        startedAt: IDLE_SINCE,
        changedAt: IDLE_SINCE,
      })),
    );

    // When the owner moves each of them, an earlier Idle and an unknown employee to Review
    const answers = await Promise.all(
      [
        toReview(IDLE_SINCE.toISOString(), "working"),
        toReview(IDLE_SINCE.toISOString(), "review"),
        toReview(IDLE_SINCE.toISOString(), "wentHome"),
        toReview(new Date(IDLE_SINCE.getTime() - 1000).toISOString()),
        toReview(IDLE_SINCE.toISOString(), "nobody"),
      ].map(async (response) => (await response).json()),
    );

    // Then none was marked, nothing was created and each keeps its state
    expect(answers).toEqual(Array(5).fill({ marked: 0 }));
    const states = (await changes()).sessions.map((session) => [
      session.sessionId,
      session.state,
    ]);
    expect(states.sort()).toEqual([
      ["review", "review"],
      ["s1", "idle"],
      ["wentHome", "wentHome"],
      ["working", "working"],
    ]);
  });

  it("refuses a caller that is not the owner, and a malformed body, and marks nothing", async () => {
    const body = {
      machineId: "m1",
      sessionId: "s1",
      stateSince: IDLE_SINCE.toISOString(),
    };

    // When someone without the owner's session asks
    const stranger = await POST(post("to-review", body));

    // Then it is refused
    expect(stranger.status).toBe(401);

    // And the owner's malformed bodies, a list or an unknown field included, are 400
    const bodies = [
      { ...body, stateSince: "yesterday" },
      { ...body, sessionId: "" },
      { items: [body] },
      { ...body, state: "review" },
    ];
    for (const malformed of bodies) {
      expect(
        (await POST(post("to-review", malformed, ownerHeaders))).status,
      ).toBe(400);
    }
    const notJson = new NextRequest(
      "http://localhost:4710/api/office/sessions/to-review",
      { method: "POST", headers: ownerHeaders, body: "{" },
    );
    expect((await POST(notJson)).status).toBe(400);

    // And the employee is still Idle
    expect(await shown()).toEqual(["idle", IDLE_SINCE.toISOString()]);
  });

  it("brings back a Review the owner moved to Idle, named by the Idle time the owner saw", async () => {
    // Given a Review the owner moved to Idle, which every device shows Idle from the move
    await (await getDb())
      .collection("sessions")
      .updateOne({ sessionId: "s1" }, { $set: { state: "review" } });
    await toIdle(IDLE_SINCE.toISOString());
    const [, idleSince] = await shown();

    // When the owner moves that Idle to Review
    const response = await toReview(String(idleSince));

    // Then it is the Review it was, with its own time
    expect(await response.json()).toEqual({ marked: 1 });
    expect(await shown()).toEqual(["review", IDLE_SINCE.toISOString()]);
  });

  it("brings back a Review the owner moved to Idle when named by its Review time, as a device that has not polled since its move does", async () => {
    // Given a Review the owner moved to Idle
    await (await getDb())
      .collection("sessions")
      .updateOne({ sessionId: "s1" }, { $set: { state: "review" } });
    await toIdle(IDLE_SINCE.toISOString());

    // When the owner moves it to Review, named by the Review time that device still holds
    const response = await toReview(IDLE_SINCE.toISOString());

    // Then it is the Review it was
    expect(await response.json()).toEqual({ marked: 1 });
    expect(await shown()).toEqual(["review", IDLE_SINCE.toISOString()]);
  });
});
