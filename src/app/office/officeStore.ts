import type { FolderDto } from "@/shared/folders";
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

/** Company-mode switches the owner pressed that no answer has confirmed yet, keyed by `overrideKey`. */
export type ModeOverrides = ReadonlyMap<string, boolean>;

/**
 * The map key of one folder of one Mac.
 * @param machineId - The Mac.
 * @param path - The folder.
 * @returns A key unique across Macs.
 */
export function overrideKey(machineId: string, path: string): string {
  return `${machineId}\0${path}`;
}

/**
 * Lays the owner's pending switches over the folder records an answer carried.
 * @param folders - Records from the latest answer.
 * @param overrides - Pending switches.
 * @returns The records with each pending value in force; a folder with no record yet gets one.
 */
export function applyOverrides(
  folders: FolderDto[],
  overrides: ModeOverrides,
): FolderDto[] {
  const pending = new Map(overrides);
  const laid = folders.map((record) => {
    const key = overrideKey(record.machineId, record.path);
    const value = pending.get(key);
    pending.delete(key);
    return value === undefined ? record : { ...record, companyMode: value };
  });
  // What is left has no record yet.
  for (const [key, companyMode] of pending) {
    const [machineId = "", path = ""] = key.split("\0");
    laid.push({ machineId, path, companyMode });
  }
  return laid;
}

/**
 * Drops the pending switches an answer now agrees with.
 * @param overrides - Pending switches.
 * @param folders - Records from the latest answer.
 * @returns The switches still waiting for an answer to agree.
 */
export function settleOverrides(
  overrides: ModeOverrides,
  folders: FolderDto[],
): ModeOverrides {
  const agreed = new Set(
    folders.map(
      (record) =>
        `${overrideKey(record.machineId, record.path)}\0${record.companyMode}`,
    ),
  );
  return new Map(
    [...overrides].filter(([key, value]) => !agreed.has(`${key}\0${value}`)),
  );
}
