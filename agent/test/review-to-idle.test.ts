import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as moveReviewToIdle } from "@/app/api/office/sessions/review-seen/route";
import { getDb } from "@/db/mongo";
import { sessionHeadersFor } from "@/test/owner-session";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const REVIEW_SINCE = new Date("2026-11-08T08:00:00.000Z");
const MOVED_AT = new Date("2026-11-08T09:30:00.000Z");

describe("a Review the owner moved to Idle, when the Mac's agent restarts", () => {
  const { setUpMac } = useMacHarness();
  const processes = useLiveProcesses();

  /** Stores a Review row with the given mark, restarts the agent over the same finished conversation and returns the state the agent then stored. */
  async function restartOverReview(
    mark:
      | { reviewSeenAt: Date; reviewClearedAt?: Date }
      | Record<string, never>,
    stored: { state: string; stateSince: Date } = {
      state: "review",
      stateSince: REVIEW_SINCE,
    },
  ) {
    const db = await getDb();
    await db.collection("sessions").insertOne({
      machineId: "machine-air",
      machineName: "Air",
      sessionId: "s1",
      cwd: "/work/a",
      ...stored,
      ...mark,
      startedAt: new Date(REVIEW_SINCE.getTime() - 3_600_000),
      changedAt: new Date(),
    });
    const live = await processes.live();
    await setUpMac("machine-air", "Air", {
      beforeStart(fake) {
        fake.addSession({
          sessionId: "s1",
          cwd: "/work/a",
          pid: live.pid,
          procStart: live.procStart,
          status: "idle",
        });
        fake.addTranscript("s1", [
          { type: "user", cwd: "/work/a", message: { content: "do it" } },
          {
            type: "assistant",
            cwd: "/work/a",
            message: { content: [{ type: "text", text: "All done." }] },
          },
        ]);
      },
    });
    return await db.collection("sessions").findOne({ sessionId: "s1" });
  }

  it("stores Idle for a Review the owner moved to Idle", async () => {
    // When the agent restarts over a Review the owner moved to Idle
    const cleared = await restartOverReview({ reviewSeenAt: REVIEW_SINCE });

    // Then it stores Idle
    expect(cleared?.state).toBe("idle");
  }, 60_000);

  it("counts the Idle time from the move, not from the turn's end", async () => {
    // When the agent restarts over a Review the owner moved to Idle at 09:30
    const row = await restartOverReview({
      reviewSeenAt: REVIEW_SINCE,
      reviewClearedAt: MOVED_AT,
    });

    // Then Idle began at the move
    expect(row?.stateSince).toEqual(MOVED_AT);
  }, 60_000);

  it("keeps counting Idle from the move after a second restart", async () => {
    // Given the first restart already stored Idle from the move at 09:30
    // When the agent restarts again over the same finished conversation
    const row = await restartOverReview(
      { reviewSeenAt: REVIEW_SINCE, reviewClearedAt: MOVED_AT },
      { state: "idle", stateSince: MOVED_AT },
    );

    // Then Idle still began at the move, not at the turn's end
    expect(row?.stateSince).toEqual(MOVED_AT);
  }, 60_000);

  it("keeps the stored Review time of a Review the owner has not moved to Idle, so a Move to Idle sent with it still matches", async () => {
    // When the agent restarts over a Review with no mark
    const row = await restartOverReview({});

    // Then it is the same Review, dated when it began, not when the registry last changed status
    expect(row?.state).toBe("review");
    expect(row?.stateSince).toEqual(REVIEW_SINCE);
  }, 60_000);

  it("stores Review when the mark names an earlier Review than the one stored", async () => {
    // When the agent restarts over a Review whose mark is for an earlier one
    const state = await restartOverReview({
      reviewSeenAt: new Date(REVIEW_SINCE.getTime() - 60_000),
    });

    // Then it is Review again
    expect(state?.state).toBe("review");
  }, 60_000);
});

describe("a Review the owner moved to Idle, when the same conversation finishes another turn", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders =
      (await sessionHeadersFor("owner@example.com")) ?? new Headers();
  });

  it("shows Review again for a later turn that ends with a result, as a finishing background sub-agent does", async () => {
    // Given a Review the owner moved to Idle, on an agent with no key
    const { fake, agent } = await setUpMac("machine-air", "Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/app" });
    const send = async (event: Record<string, unknown>) => {
      await runHook(fake.home, {
        session_id: "s1",
        cwd: "/work/app",
        ...event,
      });
      await agent.flush();
      return (await officeSessions())[0]?.state;
    };
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "plan it" });
    const first = await send({
      hook_event_name: "Stop",
      last_assistant_message: "Done, all tests pass.",
    });
    expect(first).toBe("review");
    const row = await (await getDb())
      .collection("sessions")
      .findOne({ sessionId: "s1" });
    await moveReviewToIdle(
      new NextRequest("http://localhost:4710/api/office/sessions/review-seen", {
        method: "POST",
        headers: new Headers([
          ...ownerHeaders,
          ["content-type", "application/json"],
        ]),
        body: JSON.stringify({
          items: [
            {
              machineId: "machine-air",
              sessionId: "s1",
              stateSince: row?.stateSince.toISOString(),
            },
          ],
        }),
      }),
    );
    expect((await officeSessions())[0]?.state).toBe("idle");

    // When a background task starts a new turn in that conversation and it ends with a result
    await send({ hook_event_name: "UserPromptSubmit", prompt: "task done" });
    const later = await send({
      hook_event_name: "Stop",
      last_assistant_message: "The background run finished, all green.",
    });

    // Then the employee is in Review again
    expect(later).toBe("review");
  }, 60_000);
});
