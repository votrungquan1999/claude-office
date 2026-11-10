import type { Collection } from "mongodb";
import { removeLaunchFiles } from "./terminal-launch";
import type { TagDoc } from "./tracker";

/** A window the office opened: the session it will run, where, and when. */
export interface LaunchRecord {
  sessionId: string;
  /** The session the launch files are named after; `sessionId` moves when the window switches conversation. */
  launchId: string;
  folder: string;
  kind: "hired";
  launchedAt: number;
  /** Whether the script and message files are still on disk. */
  filesPresent: boolean;
}

/** The sessions this agent opened, kept at their desks; held in memory for this run. */
export class KeptDesks {
  private readonly records = new Map<string, LaunchRecord>();

  /**
   * Remembers a launch.
   * @param record - The launch.
   */
  add(record: LaunchRecord): void {
    this.records.set(record.sessionId, record);
  }

  /**
   * Moves a launch to the conversation its window switched to.
   * @param fromId - The session the launch was recorded for.
   * @param toId - The session now running in that window.
   */
  moveKept(fromId: string, toId: string): void {
    const record = this.records.get(fromId);
    if (!record) return;
    this.records.delete(fromId);
    this.records.set(toId, { ...record, sessionId: toId });
  }

  /** Launches whose files are still on disk. */
  withFiles(): LaunchRecord[] {
    return [...this.records.values()].filter((record) => record.filesPresent);
  }

  /**
   * Notes that a launch's files were deleted.
   * @param sessionId - The launch's session.
   */
  filesRemoved(sessionId: string): void {
    const record = this.records.get(sessionId);
    if (record) record.filesPresent = false;
  }
}

/**
 * Deletes the launch files of every kept window whose session has registered.
 * @param kept - The kept desks.
 * @param home - The user's home folder.
 * @param registered - Session ids that have a registry entry.
 */
export function cleanLaunchFiles(
  kept: KeptDesks,
  home: string,
  registered: Set<string>,
): void {
  for (const launch of kept.withFiles()) {
    if (!registered.has(launch.sessionId)) continue;
    removeLaunchFiles(home, launch.launchId);
    kept.filesRemoved(launch.sessionId);
  }
}

/** The fields of a stored session row that the kept-desk reads use. */
interface SessionRowDocument {
  sessionId: string;
  kept?: "hired" | "woken";
  cwd: string;
  startCwd?: string;
  startedAt: Date;
  hadPrompt?: boolean;
  deskName?: string | null;
  tags?: TagDoc[];
  notRunning?: boolean;
  stateSince?: Date;
}

/** A kept desk of this Mac as stored on the previous run. */
export interface StoredKept {
  sessionId: string;
  kept: "hired" | "woken";
  cwd: string;
  startCwd?: string;
  startedAt: Date;
  hadPrompt: boolean;
  deskName?: string;
  tags: TagDoc[];
  /** Set when the desk was already showing "not running". */
  notRunning: boolean;
  stateSince?: Date;
}

/**
 * Reads this Mac's kept desks that have not gone home.
 * @param sessions - The sessions collection.
 * @param machineId - This Mac.
 * @returns One entry per kept desk.
 */
export async function loadKept(
  sessions: Collection,
  machineId: string,
): Promise<StoredKept[]> {
  const rows = await sessions
    .find<SessionRowDocument>({
      machineId,
      kept: { $exists: true },
      endedAt: { $exists: false },
    })
    .toArray();
  return rows.map((row) => ({
    sessionId: row.sessionId,
    // The query only returns rows that carry the mark.
    kept: row.kept as "hired" | "woken",
    cwd: row.cwd,
    startCwd: row.startCwd,
    startedAt: row.startedAt,
    hadPrompt: row.hadPrompt === true,
    deskName: row.deskName ?? undefined,
    tags: (row.tags ?? []).map(({ name, key, parent }) => ({
      name,
      key,
      ...(parent !== undefined ? { parent } : {}),
    })),
    notRunning: row.notRunning === true,
    stateSince: row.stateSince,
  }));
}
