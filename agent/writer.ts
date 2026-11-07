import type {
  AnyBulkWriteOperation,
  Collection,
  Document,
  ObjectId,
} from "mongodb";
import type { StepDto } from "../src/shared/session";
import { sessionKey } from "../src/shared/session";
import type { SessionState } from "../src/shared/session-state";

/** A finished step as stored in the `steps` collection (and, newest five, on the session). */
export interface StepDoc extends Omit<StepDto, "id" | "startedAt"> {
  _id: ObjectId;
  machineId: string;
  sessionId: string;
  startedAt: Date;
}

/** A session as the agent stores it; `changedAt` is stamped by the database clock. */
export interface SessionDoc {
  machineId: string;
  machineName: string;
  sessionId: string;
  cwd: string;
  state: SessionState;
  startedAt: Date;
  endedAt?: Date;
  bridgeSessionId?: string;
  deskName?: string;
  runningSteps?: Array<{ text: string; startedAt: Date }>;
  currentTodo?: string | null;
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
  /** Steps finished since this session was last queued; they go out with its next write. */
  pendingSteps: StepDoc[];
  timer?: NodeJS.Timeout;
}

const EXPIRY_DAYS = 7;
const RECENT_STEPS = 5;

/**
 * Writes session snapshots with a per-session throttle (leading write, then at most one per
 * `flushMs`, never a restarting debounce) and a per-agent ops cap, batched into `bulkWrite`.
 */
export class SessionWriter {
  private readonly slots = new Map<string, Slot>();
  private batch: Array<{ doc: SessionDoc; steps: StepDoc[] }> = [];
  private batchScheduled = false;
  private readonly writes = new Set<Promise<void>>();
  private tokens: number;
  private tokensAt: number;

  constructor(
    private readonly sessions: Collection,
    private readonly steps: Collection,
    private readonly options: WriterOptions,
  ) {
    this.tokens = options.maxOpsPerSecond;
    this.tokensAt = options.now();
  }

  /**
   * Queues a snapshot; nothing is written when it equals the last one queued for that session.
   * @param doc - The session's current snapshot.
   * @param steps - Steps finished since the last submit; they are never dropped as duplicates.
   */
  submit(doc: SessionDoc, steps: StepDoc[] = []): void {
    const key = sessionKey(doc);
    const slot = this.slots.get(key) ?? { pendingSteps: [] };
    this.slots.set(key, slot);
    slot.pendingSteps.push(...steps);
    const json = JSON.stringify(doc);
    if (json === slot.latestJson && slot.pendingSteps.length === 0) return;
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
    this.batch.push({ doc: slot.pending, steps: slot.pendingSteps });
    slot.pendingSteps = [];
    slot.lastWriteAt = this.options.now();
    slot.pending = undefined;
    if (this.batchScheduled) return;
    this.batchScheduled = true;
    // Same-tick submissions share one bulkWrite.
    queueMicrotask(() => this.writeBatch());
  }

  private writeBatch(): void {
    this.batchScheduled = false;
    const entries = this.batch;
    this.batch = [];
    if (entries.length === 0) return;
    const expireAt = new Date(this.options.now() + EXPIRY_DAYS * 86_400_000);
    const steps = entries.flatMap((entry) => entry.steps);
    const write = Promise.all([
      this.sessions.bulkWrite(
        entries.map(({ doc, steps }) => toUpdate(doc, steps)),
        { ordered: false },
      ),
      steps.length > 0
        ? this.steps.insertMany(
            steps.map((step) => ({ ...step, expireAt })),
            { ordered: false },
          )
        : undefined,
    ])
      .then(
        () => {},
        (error: unknown) => {
          // A failed write must be retried by the next change, so forget what was queued for it.
          for (const { doc } of entries) {
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

function toUpdate(doc: SessionDoc, steps: StepDoc[]): AnyBulkWriteOperation {
  const { machineId, sessionId, startedAt, endedAt, ...rest } = doc;
  // A session that no longer reports an id must lose the stored one, or the link points at a dead session.
  const absent = [
    ...(endedAt ? [] : ["endedAt", "expireAt"]),
    ...(doc.bridgeSessionId ? [] : ["bridgeSessionId"]),
    // A removed card with no fallback name must not leave its old title on the desk.
    ...(doc.deskName ? [] : ["deskName"]),
  ];
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
        ...(absent.length
          ? { $unset: Object.fromEntries(absent.map((key) => [key, ""])) }
          : {}),
        // The session keeps its five latest-started finished steps so the office poll stays one query.
        ...(steps.length > 0
          ? {
              $push: {
                recentSteps: {
                  $each: steps.map(
                    ({ _id, machineId, sessionId, ...step }) => ({
                      id: _id.toHexString(),
                      ...step,
                    }),
                  ),
                  // Sorted by start, not arrival: parallel steps finish out of order.
                  $sort: { startedAt: 1, id: 1 },
                  $slice: -RECENT_STEPS,
                },
              },
            }
          : {}),
        $currentDate: { changedAt: true },
      } as Document,
      upsert: true,
    },
  };
}
