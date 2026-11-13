import { useRef, useState } from "react";
import { moveTo } from "@/shared/list-order";
import { type SessionDto, sessionKey } from "@/shared/session";
import { type PendingRanks, postRanks, refuseRanks } from "./pendingRanks";

interface RowMovesInput {
  /** The places the owner gave on this device that no answer has settled yet. */
  getRanks: () => PendingRanks;
  setRanks: (ranks: PendingRanks) => void;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  /** The viewed company's live rows in list order, and which of them the tag filter shows. */
  viewedRows: () => {
    rows: SessionDto[];
    matches: (session: SessionDto) => boolean;
  };
}

/**
 * Moving a row to a new place: shows it at once, sends the places, and takes them back when refused.
 * @param input - The pending places and the rows being viewed.
 * @returns The move handler and why the last move was refused, if it was.
 */
export function useRowMoves({
  getRanks,
  setRanks,
  serverOffsetMs,
  viewedRows,
}: RowMovesInput) {
  const [rankError, setRankError] = useState<string | null>(null);
  // Numbers each move, so refusing an old move never takes back a newer place.
  const tokenRef = useRef(0);

  /**
   * Moves a row to the place of the row it was dropped on.
   * @param key - The row that was dragged.
   * @param overKey - The row it was dropped on, found again in the order as it is now.
   */
  const moveRow = async (key: string, overKey: string) => {
    const { rows, matches } = viewedRows();
    const targetIndex = rows
      .filter(matches)
      .findIndex((row) => sessionKey(row) === overKey);
    if (targetIndex < 0) return;
    const places = moveTo(rows, key, targetIndex, matches);
    if (places.length === 0) return;
    const token = ++tokenRef.current;
    const movedAt = new Date(Date.now() + serverOffsetMs).toISOString();
    setRankError(null);
    setRanks(
      new Map([
        ...getRanks(),
        ...places.map(
          ({ machineId, sessionId, rank }) =>
            [
              sessionKey({ machineId, sessionId }),
              { rank, token, movedAt },
            ] as const,
        ),
      ]),
    );
    if (await postRanks({ items: places })) return;
    setRanks(refuseRanks(getRanks(), token));
    setRankError("Could not move. Try again.");
  };

  return { moveRow, rankError };
}
