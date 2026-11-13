import { useRef, useState } from "react";
import { moveTo, type RankAssignment } from "@/shared/list-order";
import { type SessionDto, sessionKey } from "@/shared/session";
import {
  acceptRanks,
  type PendingRanks,
  postRanks,
  refuseRanks,
} from "./pendingRanks";

interface RowMovesInput {
  /** The places the owner gave on this device that no answer has settled yet. */
  getRanks: () => PendingRanks;
  setRanks: (ranks: PendingRanks) => void;
  /** The number of the last poll started so far. */
  lastStartedPoll: () => number;
  /** The company being viewed; a refusal belongs to the company it happened in. */
  companyKey: string | null;
  /** The viewed company's live rows in list order, and which of them the tag filter shows. */
  viewedRows: () => {
    rows: SessionDto[];
    matches: (session: SessionDto) => boolean;
  };
}

/**
 * Moving a row to a new place: shows it at once, sends the places, and takes them back when refused.
 * @param input - The pending places and the rows being viewed.
 * @returns The move handlers, why the last move was refused, and the refusal of a card move.
 */
export function useRowMoves({
  getRanks,
  setRanks,
  lastStartedPoll,
  viewedRows,
  companyKey,
}: RowMovesInput) {
  const [refused, setRefusal] = useState<{
    message: string;
    viaCard: boolean;
    companyKey: string | null;
  } | null>(null);
  const refusal = refused?.companyKey === companyKey ? refused : null;
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
    await save(moveTo(rows, key, targetIndex, matches), false);
  };

  /**
   * Moves a row to the top or the bottom of the company's whole list, whatever a filter hides.
   * @param key - The row to move.
   * @param end - Which end.
   */
  const moveToEnd = async (key: string, end: "top" | "bottom") => {
    const { rows } = viewedRows();
    // The target counts the rows without the moved one, so the last place is rows.length - 1.
    await save(moveTo(rows, key, end === "top" ? 0 : rows.length - 1), true);
  };

  /**
   * Shows the places at once, sends them in one request, and takes them back when refused.
   * @param places - The places to save; nothing is sent when empty.
   * @param viaCard - Whether the owner pressed a button on the details card, so a refusal shows there too.
   */
  const save = async (places: RankAssignment[], viaCard: boolean) => {
    if (places.length === 0) return;
    const token = ++tokenRef.current;
    setRefusal(null);
    setRanks(
      new Map([
        ...getRanks(),
        ...places.map(
          ({ machineId, sessionId, rank }) =>
            [
              sessionKey({ machineId, sessionId }),
              { rank, token, storedAfterPoll: null },
            ] as const,
        ),
      ]),
    );
    if (await postRanks({ items: places })) {
      // The server holds the places now; an answer to a poll started from here on is the truth, whatever place it shows.
      setRanks(acceptRanks(getRanks(), token, lastStartedPoll()));
      return;
    }
    setRanks(refuseRanks(getRanks(), token));
    setRefusal({ message: "Could not move. Try again.", viaCard, companyKey });
  };

  return {
    moveRow,
    moveToEnd,
    rankError: refusal?.message ?? null,
    placeError: refusal?.viaCard ? refusal.message : undefined,
  };
}
