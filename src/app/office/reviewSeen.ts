import type { ReviewSeenRequest, SessionDto } from "@/shared/session";
import type { SessionMap } from "./officeStore";

/** A Review the owner moved to Idle on this device that no answer has confirmed yet, keyed by `sessionKey`. */
export type ReviewMoves = ReadonlyMap<
  string,
  {
    /** The `stateSince` of the Review the owner saw. */
    stateSince: string;
    /** When the owner moved it, on the server's clock. */
    movedAt: string;
  }
>;

/** Whether the session is still in the very Review the owner saw. */
function isSeenReview(
  session: SessionDto | undefined,
  stateSince: string,
): session is SessionDto {
  return session?.state === "review" && session.stateSince === stateSince;
}

/**
 * Shows each pending move as Idle.
 * @param sessions - The sessions the answers carried.
 * @param moves - The moves waiting for an answer.
 * @returns The sessions with every moved Review shown as Idle, timed from the move.
 */
export function applyReviewMoves(
  sessions: SessionMap,
  moves: ReviewMoves,
): SessionMap {
  if (moves.size === 0) return sessions;
  const shown = new Map(sessions);
  for (const [key, move] of moves) {
    const session = sessions.get(key);
    if (isSeenReview(session, move.stateSince)) {
      shown.set(key, { ...session, state: "idle", stateSince: move.movedAt });
    }
  }
  return shown;
}

/**
 * Drops the moves an answer has caught up with.
 * @param moves - The moves waiting for an answer.
 * @param sessions - The sessions the answers carried.
 * @returns The moves whose Review is still the one shown.
 */
export function settleReviewMoves(
  moves: ReviewMoves,
  sessions: SessionMap,
): ReviewMoves {
  return new Map(
    [...moves].filter(([key, move]) =>
      isSeenReview(sessions.get(key), move.stateSince),
    ),
  );
}

/**
 * Sends the Reviews the owner moved to Idle to the server.
 * @param request - The Reviews, each with the `stateSince` the owner saw.
 * @returns How many Reviews the server marked (fewer than sent when some had already moved on), or undefined on any refusal or network failure.
 */
export async function postReviewSeen(
  request: ReviewSeenRequest,
): Promise<number | undefined> {
  try {
    const response = await fetch("/api/office/sessions/review-seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json().catch(() => undefined);
    const marked = (body as { marked?: unknown } | undefined)?.marked;
    return typeof marked === "number" ? marked : request.items.length;
  } catch {
    return undefined;
  }
}
