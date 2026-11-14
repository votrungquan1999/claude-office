import type {
  MoveToReviewRequest,
  ReviewSeenRequest,
  SessionDto,
} from "@/shared/session";
import type { SessionMap } from "./officeStore";

/** A Review the owner moved to Idle, or an Idle moved to Review, on this device that no answer has confirmed yet. */
export interface ReviewMove {
  /** Where the owner moved it. */
  to: "idle" | "review";
  /** The `stateSince` of the Review (or Idle) the owner saw. */
  stateSince: string;
  /** When the owner moved it, on the server's clock. */
  movedAt: string;
}

/** The pending moves, keyed by `sessionKey`. */
export type ReviewMoves = ReadonlyMap<string, ReviewMove>;

/** Whether the session is still in the very Review (or Idle) the owner moved. */
function isStillSeen(
  session: SessionDto | undefined,
  move: ReviewMove,
): session is SessionDto {
  const from = move.to === "idle" ? "review" : "idle";
  return session?.state === from && session.stateSince === move.stateSince;
}

/**
 * Shows each pending move as the state the owner picked.
 * @param sessions - The sessions the answers carried.
 * @param moves - The moves waiting for an answer.
 * @returns The sessions with every moved Review shown as Idle, timed from the move, and every moved Idle shown as Review.
 */
export function applyReviewMoves(
  sessions: SessionMap,
  moves: ReviewMoves,
): SessionMap {
  if (moves.size === 0) return sessions;
  const shown = new Map(sessions);
  for (const [key, move] of moves) {
    const session = sessions.get(key);
    if (!isStillSeen(session, move)) continue;
    shown.set(
      key,
      move.to === "idle"
        ? { ...session, state: "idle", stateSince: move.movedAt }
        : { ...session, state: "review" },
    );
  }
  return shown;
}

/**
 * Drops the moves an answer has caught up with.
 * @param moves - The moves waiting for an answer.
 * @param sessions - The sessions the answers carried.
 * @returns The moves whose Review (or Idle) is still the one shown.
 */
export function settleReviewMoves(
  moves: ReviewMoves,
  sessions: SessionMap,
): ReviewMoves {
  return new Map(
    [...moves].filter(([key, move]) => isStillSeen(sessions.get(key), move)),
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

/**
 * Sends the Idle employee the owner moved to Review to the server.
 * @param request - The employee, with the `stateSince` the owner saw.
 * @returns How many the server marked (0 when that Idle had already moved on), or undefined on any refusal or network failure.
 */
export async function postMoveToReview(
  request: MoveToReviewRequest,
): Promise<number | undefined> {
  try {
    const response = await fetch("/api/office/sessions/to-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json().catch(() => undefined);
    const marked = (body as { marked?: unknown } | undefined)?.marked;
    return typeof marked === "number" ? marked : 1;
  } catch {
    return undefined;
  }
}
