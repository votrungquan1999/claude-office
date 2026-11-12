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

/** One name the owner pressed; null puts the folder name back. */
export interface PendingName {
  name: string | null;
  /** Which request carries it, so an answer to an older request cannot touch a newer name. */
  token: number;
  /** Null until the server stored it, then the last poll started by that moment; any later poll's answer is the truth, whatever it shows. */
  storedAfterPoll: number | null;
}

/** Company names the owner pressed that no answer has settled yet, keyed by `overrideKey`. */
export type NameOverrides = ReadonlyMap<string, PendingName>;

/**
 * Lays the owner's pending names over the folder records.
 * @param folders - Records, with any pending switches already laid over them.
 * @param names - Pending names.
 * @returns The records with each pending name in force; a folder with no record yet gets one with company mode on.
 */
export function applyNames(
  folders: FolderDto[],
  names: NameOverrides,
): FolderDto[] {
  const pending = new Map(names);
  const laid: FolderDto[] = folders.map((record) => {
    const key = overrideKey(record.machineId, record.path);
    const value = pending.get(key);
    pending.delete(key);
    if (value === undefined) return record;
    const { displayName: _old, ...rest } = record;
    return value.name === null ? rest : { ...rest, displayName: value.name };
  });
  // What is left has no record yet; a reset there has nothing to take away.
  for (const [key, { name }] of pending) {
    if (name === null) continue;
    const [machineId = "", path = ""] = key.split("\0");
    laid.push({ machineId, path, companyMode: true, displayName: name });
  }
  return laid;
}

/**
 * Drops the pending names an answer settles: those it agrees with and those the server stored before its poll started.
 * @param names - Pending names.
 * @param folders - Records from the answer.
 * @param poll - The number of the poll the answer belongs to.
 * @returns The names still waiting for the server.
 */
export function settleNames(
  names: NameOverrides,
  folders: FolderDto[],
  poll: number,
): NameOverrides {
  const shown = new Map(
    folders.map((record) => [
      overrideKey(record.machineId, record.path),
      record.displayName ?? null,
    ]),
  );
  // A folder with no record shows no name, so a reset pending on it is already true.
  return new Map(
    [...names].filter(([key, { name, storedAfterPoll }]) =>
      // A poll started before the save may still carry the old name.
      storedAfterPoll === null
        ? (shown.get(key) ?? null) !== name
        : poll <= storedAfterPoll,
    ),
  );
}

/**
 * Records that the server stored a request's name.
 * @param names - Pending names.
 * @param key - The folder's `overrideKey`.
 * @param token - The request that was stored.
 * @param lastStartedPoll - The number of the last poll started when the server answered.
 * @returns The names with that one marked stored; unchanged when a newer request owns the folder.
 */
export function acceptName(
  names: NameOverrides,
  key: string,
  token: number,
  lastStartedPoll: number,
): NameOverrides {
  const pending = names.get(key);
  if (pending?.token !== token) return names;
  return new Map(names).set(key, {
    ...pending,
    storedAfterPoll: lastStartedPoll,
  });
}

/**
 * Takes back the name of a request the server refused.
 * @param names - Pending names.
 * @param key - The folder's `overrideKey`.
 * @param token - The request that was refused.
 * @returns The names without that one; the same map when a newer request owns the folder.
 */
export function refuseName(
  names: NameOverrides,
  key: string,
  token: number,
): NameOverrides {
  if (names.get(key)?.token !== token) return names;
  const reverted = new Map(names);
  reverted.delete(key);
  return reverted;
}
