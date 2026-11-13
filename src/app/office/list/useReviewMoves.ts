import { useState } from "react";
import type { SessionMap } from "../officeStore";
import { postReviewSeen, type ReviewMoves } from "../reviewSeen";

interface ReviewMovesInput {
  /** The sessions as the answers carried them. */
  getSessions: () => SessionMap;
  /** The moves on this device that no answer has settled yet. */
  getMoves: () => ReviewMoves;
  setMoves: (moves: ReviewMoves) => void;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
}

/**
 * Moving Reviews to Idle: shows them at once, sends one request for all, and takes them back when refused.
 * @param input - The sessions, the pending moves and the clock offset.
 * @returns The move handler and which moves the last refusal took back.
 */
export function useReviewMoves({
  getSessions,
  getMoves,
  setMoves,
  serverOffsetMs,
}: ReviewMovesInput) {
  const [refused, setRefused] = useState<{
    keys: ReadonlySet<string>;
    all: boolean;
  }>({ keys: new Set(), all: false });

  /**
   * Moves Review employees to Idle with one request.
   * @param keys - The `sessionKey`s to move; any that is no longer in Review is skipped.
   * @param all - Whether the owner moved a whole list, so a refusal is shown for the list and not for one card.
   */
  const moveReviewsToIdle = async (keys: string[], all = false) => {
    const sessions = getSessions();
    const items = keys.flatMap((key) => {
      const session = sessions.get(key);
      return session?.state === "review" && session.stateSince
        ? [
            {
              key,
              machineId: session.machineId,
              sessionId: session.sessionId,
              stateSince: session.stateSince,
            },
          ]
        : [];
    });
    if (items.length === 0) return;
    setRefused({ keys: new Set(), all: false });
    const movedAt = new Date(Date.now() + serverOffsetMs).toISOString();
    const next = new Map(getMoves());
    for (const { key, stateSince } of items)
      next.set(key, { stateSince, movedAt });
    setMoves(next);
    const marked = await postReviewSeen({
      items: items.map(({ machineId, sessionId, stateSince }) => ({
        machineId,
        sessionId,
        stateSince,
      })),
    });
    if (marked !== undefined && marked > 0) return;
    // A move the answers already settled has nothing to take back.
    const reverted = new Map(getMoves());
    const taken = items.filter(
      ({ key, stateSince }) => reverted.get(key)?.stateSince === stateSince,
    );
    for (const { key } of taken) reverted.delete(key);
    setMoves(reverted);
    // Marking nothing means the Review had already moved on: the real state shows again with no failure message.
    if (marked === undefined) {
      setRefused({ keys: new Set(taken.map(({ key }) => key)), all });
    }
  };

  return { moveReviewsToIdle, refused };
}
