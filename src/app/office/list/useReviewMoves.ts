import { useState } from "react";
import type { SessionState } from "@/shared/session-state";
import type { SessionMap } from "../officeStore";
import {
  applyReviewMoves,
  postMoveToReview,
  postReviewSeen,
  type ReviewMoves,
} from "../reviewSeen";

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
 * Moving Reviews and Waiting for you employees to Idle and an Idle to Review: shows the move at once, sends one request, and takes it back when refused.
 * @param input - The sessions, the pending moves and the clock offset.
 * @returns The move handlers and which moves the last refusal took back.
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
    /** Where the refused move was going. */
    to: "idle" | "review";
  }>({ keys: new Set(), all: false, to: "idle" });

  /**
   * The employee to move when the owner sees it in one of the given states, named by the time the answers hold.
   * @param key - The employee's `sessionKey`.
   * @param shownStates - The states the button moves it out of.
   * @returns Its machine, session, the state it is shown in and its `stateSince`, or undefined when it is not shown in one of those states.
   */
  const targetOf = (key: string, shownStates: readonly SessionState[]) => {
    const session = applyReviewMoves(getSessions(), getMoves()).get(key);
    if (!session?.stateSince || !shownStates.includes(session.state))
      return undefined;
    // A move no answer has shown yet names the employee by the time it was made from.
    const stateSince = getMoves().get(key)?.stateSince ?? session.stateSince;
    return {
      machineId: session.machineId,
      sessionId: session.sessionId,
      from: session.state,
      stateSince,
    };
  };

  /**
   * Moves Review and Waiting for you employees to Idle with one request.
   * @param keys - The `sessionKey`s to move; any that is no longer in Review or Waiting for you is skipped.
   * @param all - Whether the owner moved a whole list, so a refusal is shown for the list and not for one card.
   */
  const moveReviewsToIdle = async (keys: string[], all = false) => {
    const items = keys.flatMap((key) => {
      const target = targetOf(key, ["review", "waitingForYou"]);
      return target ? [{ key, ...target }] : [];
    });
    if (items.length === 0) return;
    setRefused({ keys: new Set(), all: false, to: "idle" });
    const movedAt = new Date(Date.now() + serverOffsetMs).toISOString();
    const next = new Map(getMoves());
    for (const { key, from, stateSince } of items)
      next.set(key, { from, to: "idle", stateSince, movedAt });
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
    const taken = items.filter(({ key, stateSince }) => {
      const pending = reverted.get(key);
      return pending?.to === "idle" && pending.stateSince === stateSince;
    });
    for (const { key } of taken) reverted.delete(key);
    setMoves(reverted);
    // Marking nothing means the Review had already moved on: the real state shows again with no failure message.
    if (marked === undefined) {
      setRefused({
        keys: new Set(taken.map(({ key }) => key)),
        all,
        to: "idle",
      });
    }
  };

  /**
   * Moves one Idle employee to Review with one request.
   * @param key - The `sessionKey` to move; skipped when it is no longer Idle.
   */
  const moveIdleToReview = async (key: string) => {
    const target = targetOf(key, ["idle"]);
    if (!target) return;
    const { machineId, sessionId, from, stateSince } = target;
    const movedAt = new Date(Date.now() + serverOffsetMs).toISOString();
    setRefused({ keys: new Set(), all: false, to: "review" });
    setMoves(
      new Map(getMoves()).set(key, { from, to: "review", stateSince, movedAt }),
    );
    const marked = await postMoveToReview({ machineId, sessionId, stateSince });
    if (marked !== undefined && marked > 0) return;
    // A move the answers already settled has nothing to take back.
    const pending = getMoves().get(key);
    if (pending?.to !== "review" || pending.stateSince !== stateSince) return;
    const reverted = new Map(getMoves());
    reverted.delete(key);
    setMoves(reverted);
    // Marking nothing means the Idle had already moved on: the real state shows again with no failure message.
    if (marked === undefined) {
      setRefused({ keys: new Set([key]), all: false, to: "review" });
    }
  };

  return { moveReviewsToIdle, moveIdleToReview, refused };
}
