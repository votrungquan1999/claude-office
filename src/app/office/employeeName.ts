import type { OwnerNameRequest } from "@/shared/session";
import type { SessionMap } from "./officeStore";

/** One name the owner gave; an empty name is a pending clear. */
export interface PendingEmployeeName {
  name: string;
  /** Null until the server stored it, then the last poll started by that moment; any later poll's answer is the truth, whatever it shows. */
  storedAfterPoll: number | null;
}

/** Names the owner gave on this device that no answer has confirmed yet, keyed by `sessionKey`. */
export type PendingEmployeeNames = ReadonlyMap<string, PendingEmployeeName>;

/**
 * Shows each pending name over the sessions.
 * @param sessions - The sessions the answers carried.
 * @param pending - The names waiting for an answer.
 * @returns The sessions with the owner's pending names laid over.
 */
export function applyEmployeeNames(
  sessions: SessionMap,
  pending: PendingEmployeeNames,
): SessionMap {
  if (pending.size === 0) return sessions;
  const shown = new Map(sessions);
  for (const [key, { name }] of pending) {
    const session = sessions.get(key);
    if (!session) continue;
    // An empty name takes the owner's name away
    const { ownerName: _replaced, ...rest } = session;
    shown.set(key, name ? { ...rest, ownerName: name } : rest);
  }
  return shown;
}

/**
 * Drops the names an answer has caught up with.
 * @param pending - The names waiting for an answer.
 * @param sessions - The sessions the answers carried.
 * @param poll - The number of the poll the answer belongs to.
 * @returns The names the answers do not show yet.
 */
export function settleEmployeeNames(
  pending: PendingEmployeeNames,
  sessions: SessionMap,
  poll: number,
): PendingEmployeeNames {
  return new Map(
    [...pending].filter(([key, { name, storedAfterPoll }]) => {
      const session = sessions.get(key);
      if (session === undefined) return false;
      // A poll started before the save may still carry the old name
      return storedAfterPoll === null
        ? (session.ownerName ?? "") !== name
        : poll <= storedAfterPoll;
    }),
  );
}

/**
 * Sends the owner's name for one employee to the server.
 * @param request - The employee and its new name; an empty name takes the owner's name away.
 * @returns True when the server stored it, false on any refusal or network failure.
 */
export async function postEmployeeName(
  request: OwnerNameRequest,
): Promise<boolean> {
  try {
    const response = await fetch("/api/office/sessions/name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.ok;
  } catch {
    return false;
  }
}
