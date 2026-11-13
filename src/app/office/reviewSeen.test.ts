import { describe, expect, it } from "vitest";
import { type SessionDto, sessionKey } from "@/shared/session";
import { applyReviewMoves, settleReviewMoves } from "./reviewSeen";

const REVIEW_SINCE = "2026-11-09T09:00:00.000Z";
const MOVED_AT = "2026-11-09T09:30:00.000Z";

const review = (sessionId: string, stateSince = REVIEW_SINCE): SessionDto => ({
  machineId: "m1",
  machineName: "Mac",
  sessionId,
  cwd: "/work",
  state: "review",
  stateSince,
  startedAt: REVIEW_SINCE,
  changedAt: REVIEW_SINCE,
});
const mapOf = (...sessions: SessionDto[]) =>
  new Map(sessions.map((session) => [sessionKey(session), session]));
const moved = (session: SessionDto) =>
  new Map([
    [sessionKey(session), { stateSince: REVIEW_SINCE, movedAt: MOVED_AT }],
  ]);

describe("a Review moved to Idle on this device", () => {
  it("shows as Idle timed from the move while the Review is still the one seen, and a later Review of it or another employee shows as it is", () => {
    // Given the owner moved one Review, and the sessions hold it, a later Review of the same conversation, and another Review
    const first = review("a");
    const later = review("a", "2026-11-09T10:00:00.000Z");
    const other = review("b");
    const moves = moved(first);

    // When the moves are laid over the sessions
    const shown = applyReviewMoves(mapOf(first, other), moves);
    const afterLater = applyReviewMoves(mapOf(later), moves);

    // Then the moved Review reads Idle from the move and the others stay as they are
    expect(shown.get(sessionKey(first))).toMatchObject({
      state: "idle",
      stateSince: MOVED_AT,
    });
    expect(shown.get(sessionKey(other))?.state).toBe("review");
    expect(afterLater.get(sessionKey(later))?.state).toBe("review");
  });

  it("is dropped once an answer shows Idle, a later Review or nothing, and kept while the same Review is still shown", () => {
    // Given a pending move
    const first = review("a");
    const moves = moved(first);

    // Then a poll that still carries the same Review keeps it
    expect(settleReviewMoves(moves, mapOf(first)).size).toBe(1);

    // And an answer showing Idle, a later Review, or no such session drops it
    const idle = { ...first, state: "idle" as const, stateSince: MOVED_AT };
    expect(settleReviewMoves(moves, mapOf(idle)).size).toBe(0);
    expect(
      settleReviewMoves(moves, mapOf(review("a", "2026-11-09T10:00:00.000Z")))
        .size,
    ).toBe(0);
    expect(settleReviewMoves(moves, mapOf()).size).toBe(0);
  });
});
