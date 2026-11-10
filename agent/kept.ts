/** A window the office opened: the session it will run, where, and when. */
export interface LaunchRecord {
  sessionId: string;
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
