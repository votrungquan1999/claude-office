import type { AnyBulkWriteOperation, Collection } from "mongodb";
import { sessionKey } from "../src/shared/session";
import type { SessionState } from "../src/shared/session-state";

/** A session as the agent stores it; `changedAt` is stamped by the database clock. */
export interface SessionDoc {
  machineId: string;
  machineName: string;
  sessionId: string;
  cwd: string;
  state: SessionState;
  startedAt: Date;
  endedAt?: Date;
}

export interface WriterOptions {
  flushMs: number;
  maxOpsPerSecond: number;
  now: () => number;
  log: (message: string) => void;
}

interface Slot {
  lastWriteAt?: number;
  latestJson?: string;
  pending?: SessionDoc;
  timer?: NodeJS.Timeout;
}

const EXPIRY_DAYS = 7;

/**
 * Writes session snapshots with a per-session throttle (leading write, then at most one per
 * `flushMs`, never a restarting debounce) and a per-agent ops cap, batched into `bulkWrite`.
 */
export class SessionWriter {
  private readonly slots = new Map<string, Slot>();
  private batch: SessionDoc[] = [];
  private batchScheduled = false;
  private readonly writes = new Set<Promise<void>>();
  private tokens: number;
  private tokensAt: number;

  constructor(
    private readonly sessions: Collection,
    private readonly options: WriterOptions,
  ) {
    this.tokens = options.maxOpsPerSecond;
    this.tokensAt = options.now();
  }

  /**
   * Queues a snapshot; nothing is written when it equals the last one queued for that session.
   * @param doc - The session's current snapshot.
   */
  submit(doc: SessionDoc): void {
    const key = sessionKey(doc);
    const slot = this.slots.get(key) ?? {};
    this.slots.set(key, slot);
    const json = JSON.stringify(doc);
    if (json === slot.latestJson) return;
    slot.latestJson = json;
    slot.pending = doc;
    this.schedule(slot);
  }

  /** Writes everything pending now, ignoring the throttle, and waits for all writes to land. */
  async flush(): Promise<void> {
    for (const slot of this.slots.values()) {
      clearTimeout(slot.timer);
      slot.timer = undefined;
      this.enqueue(slot);
    }
    this.writeBatch();
    await Promise.all(this.writes);
  }

  stop(): void {
    for (const slot of this.slots.values()) clearTimeout(slot.timer);
  }

  private schedule(slot: Slot): void {
    if (slot.timer) return;
    const { flushMs, now } = this.options;
    const wait = Math.max(0, (slot.lastWriteAt ?? -Infinity) + flushMs - now());
    const attempt = () => {
      slot.timer = undefined;
      if (!slot.pending) return;
      if (this.takeToken()) this.enqueue(slot);
      else this.schedule(slot);
    };
    if (wait === 0 && this.takeToken()) {
      this.enqueue(slot);
      return;
    }
    // Rescheduled with at least the cap's refill interval, so a capped slot cannot spin.
    const delay = Math.max(wait, 1000 / this.options.maxOpsPerSecond);
    slot.timer = setTimeout(attempt, delay);
    slot.timer.unref();
  }

  private takeToken(): boolean {
    const { maxOpsPerSecond, now } = this.options;
    const elapsed = now() - this.tokensAt;
    this.tokensAt = now();
    this.tokens = Math.min(
      maxOpsPerSecond,
      this.tokens + (elapsed * maxOpsPerSecond) / 1000,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private enqueue(slot: Slot): void {
    if (!slot.pending) return;
    this.batch.push(slot.pending);
    slot.lastWriteAt = this.options.now();
    slot.pending = undefined;
    if (this.batchScheduled) return;
    this.batchScheduled = true;
    // Same-tick submissions share one bulkWrite.
    queueMicrotask(() => this.writeBatch());
  }

  private writeBatch(): void {
    this.batchScheduled = false;
    const docs = this.batch;
    this.batch = [];
    if (docs.length === 0) return;
    const write = this.sessions
      .bulkWrite(docs.map(toUpdate), { ordered: false })
      .then(
        () => {},
        (error: unknown) => {
          // A failed write must be retried by the next change, so forget what was queued for it.
          for (const doc of docs) {
            const slot = this.slots.get(sessionKey(doc));
            if (slot) slot.latestJson = undefined;
          }
          this.options.log(
            `session write failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      )
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
  }
}

function toUpdate(doc: SessionDoc): AnyBulkWriteOperation {
  const { machineId, sessionId, startedAt, endedAt, ...rest } = doc;
  return {
    updateOne: {
      filter: { machineId, sessionId },
      update: {
        $set: {
          ...rest,
          ...(endedAt
            ? {
                endedAt,
                expireAt: new Date(
                  endedAt.getTime() + EXPIRY_DAYS * 86_400_000,
                ),
              }
            : {}),
        },
        $setOnInsert: { startedAt },
        ...(endedAt ? {} : { $unset: { endedAt: "", expireAt: "" } }),
        $currentDate: { changedAt: true as const },
      },
      upsert: true,
    },
  };
}
