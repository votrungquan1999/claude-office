import type { RankRequest } from "@/shared/session";
import type { SessionMap } from "../officeStore";

/** A place the owner gave a conversation that no answer has confirmed yet. */
export interface PendingRank {
  rank: string;
  /** Which move sent it, so a refusal of an older move never touches a newer one. */
  token: number;
  /** When the owner moved it, on the server's clock. */
  movedAt: string;
}

/** Places the owner gave on this device that no answer has settled yet, keyed by `sessionKey`. */
export type PendingRanks = ReadonlyMap<string, PendingRank>;

/**
 * Shows each pending place over the sessions.
 * @param sessions - The sessions the answers carried.
 * @param pending - The places waiting for an answer.
 * @returns The sessions with every pending place in force.
 */
export function applyRanks(
  sessions: SessionMap,
  pending: PendingRanks,
): SessionMap {
  if (pending.size === 0) return sessions;
  const shown = new Map(sessions);
  for (const [key, { rank }] of pending) {
    const session = sessions.get(key);
    if (session) shown.set(key, { ...session, rank });
  }
  return shown;
}

/**
 * Drops the places an answer has caught up with.
 * @param pending - The places waiting for an answer.
 * @param sessions - The sessions the answers carried.
 * @returns The places the answers do not settle yet.
 */
export function settleRanks(
  pending: PendingRanks,
  sessions: SessionMap,
): PendingRanks {
  return new Map(
    [...pending].filter(([key, move]) => {
      const session = sessions.get(key);
      // An answer that shows the place, or a later change of the row (another device moved it since), settles it.
      return (
        session !== undefined &&
        session.rank !== move.rank &&
        session.changedAt <= move.movedAt
      );
    }),
  );
}

/**
 * Takes back the places of a refused move.
 * @param pending - The places waiting for an answer.
 * @param token - The refused move.
 * @returns The places of every other move.
 */
export function refuseRanks(
  pending: PendingRanks,
  token: number,
): PendingRanks {
  return new Map([...pending].filter(([, move]) => move.token !== token));
}

/**
 * Sends the places of one move to the server.
 * @param request - The moved row and every row placed with it.
 * @returns True when the server took the request, false on any refusal or network failure.
 */
export async function postRanks(request: RankRequest): Promise<boolean> {
  try {
    const response = await fetch("/api/office/sessions/rank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.ok;
  } catch {
    return false;
  }
}
