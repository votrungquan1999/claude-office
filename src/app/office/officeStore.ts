import { type SessionDto, sessionKey } from "@/shared/session";

/** Sessions the browser knows, keyed by "machineId/sessionId". */
export type SessionMap = ReadonlyMap<string, SessionDto>;

/**
 * Folds an API answer into what the browser already has.
 * @param current - The sessions known so far.
 * @param incoming - Sessions from the latest answer.
 * @returns The merged map.
 */
export function mergeSessions(
  current: SessionMap,
  incoming: SessionDto[],
): SessionMap {
  const merged = new Map(current);
  for (const session of incoming) {
    const key = sessionKey(session);
    const known = merged.get(key);
    // The overlap window replays old snapshots; ISO timestamps compare as text.
    if (!known || session.changedAt >= known.changedAt)
      merged.set(key, session);
  }
  return merged;
}
