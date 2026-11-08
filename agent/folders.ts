import type { Collection } from "mongodb";

/** A start folder of one Mac as stored in the `folders` collection. */
export interface FolderDocument {
  machineId: string;
  path: string;
  /** Whether the folder groups its sub-folders into one company; the owner switches it. */
  companyMode: boolean;
  firstSeenAt: Date;
}

export interface FolderRecorderOptions {
  folders: Collection<FolderDocument>;
  machineId: string;
  log: (message: string) => void;
}

/** Writes each start folder the Mac sees once, with company mode on; an existing record is never touched. */
export class FolderRecorder {
  private readonly seen = new Set<string>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: FolderRecorderOptions) {}

  /**
   * Records a start folder unless it was already recorded in this run.
   * @param path - The folder a session started in.
   */
  record(path: string): void {
    if (!path || this.seen.has(path)) return;
    const { folders, machineId, log } = this.options;
    // Marked before the write so a second record() of the same folder while it is in flight does not write again.
    this.seen.add(path);
    const write = folders
      .updateOne(
        { machineId, path },
        { $setOnInsert: { companyMode: true, firstSeenAt: new Date() } },
        { upsert: true },
      )
      .catch((error: unknown) => {
        // A duplicate key means a concurrent upsert already stored it.
        if ((error as { code?: number }).code === 11000) return;
        // Forgotten again so the next publish retries the write.
        this.seen.delete(path);
        log(
          `folder write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .then(() => undefined)
      .finally(() => this.pending.delete(write));
    this.pending.add(write);
  }

  /** Waits for every folder write started so far. */
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}
