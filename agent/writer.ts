import type {
  AnyBulkWriteOperation,
  Collection,
  Document,
  ObjectId,
  OneOrMore,
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
  /** Whether the session ever got a prompt; sessions that never did stay out of the went-home list. */
  hadPrompt?: boolean;
}

export interface WriterOptions {
  flushMs: number;
  maxOpsPerSecond: number;
  now: () => number;
  log: (message: string) => void;
  /** How long to wait before trying the queue again while the database is unreachable. */
  retryMs?: number;
  /** Most finished steps held back for a database that cannot be reached; the oldest are dropped first. */
  maxQueuedSteps?: number;
}

interface Slot {
  lastWriteAt?: number;
  latestJson?: string;
  /** The newest snapshot submitted; a failed write is retried with this, never with the snapshot that failed. */
  latest?: SessionDoc;
  pending?: SessionDoc;
  /** Finished steps still to be pushed onto the session's `recentSteps`; they go out with its next write. */
  pushSteps: StepDoc[];
  /** Finished steps still to be inserted into the `steps` collection. */
  insertSteps: StepDoc[];
  timer?: NodeJS.Timeout;
  /** True from the moment a write of this session is queued until the database answers; no second one overlaps it. */
  writing?: boolean;
}

export const EXPIRY_DAYS = 7;
const RECENT_STEPS = 5;

/**
 * Writes session snapshots with a per-session throttle (leading write, then at most one per
 * `flushMs`, never a restarting debounce) and a per-agent ops cap, batched into `bulkWrite`.
 */
export class SessionWriter {
  private readonly slots = new Map<string, Slot>();
  private batch: Array<{
    doc: SessionDoc;
    pushSteps: StepDoc[];
    insertSteps: StepDoc[];
  }> = [];
  private batchScheduled = false;
  private readonly writes = new Set<Promise<void>>();
  private tokens: number;
  private tokensAt: number;
  private down = false;
  private retryTimer?: NodeJS.Timeout;

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
    const slot = this.slots.get(key) ?? { pushSteps: [], insertSteps: [] };
    this.slots.set(key, slot);
    slot.pushSteps.push(...steps);
    slot.insertSteps.push(...steps);
    if (steps.length > 0) this.trimQueuedSteps();
    const json = JSON.stringify(doc);
    if (
      json === slot.latestJson &&
      slot.pushSteps.length === 0 &&
      slot.insertSteps.length === 0
    ) {
      return;
    }
    slot.latestJson = json;
    slot.latest = doc;
    slot.pending = doc;
    this.schedule(slot);
  }

  /** Writes everything pending now, ignoring the throttle, and waits for all writes to land. */
  async flush(): Promise<void> {
    do {
      for (const slot of this.slots.values()) {
        clearTimeout(slot.timer);
        slot.timer = undefined;
        this.enqueue(slot);
      }
      this.writeBatch();
      await Promise.all(this.writes);
      // A snapshot submitted behind an in-flight write is still pending; a down database keeps it queued for the retry timer.
    } while (
      !this.down &&
      [...this.slots.values()].some((slot) => slot.pending)
    );
  }

  stop(): void {
    for (const slot of this.slots.values()) clearTimeout(slot.timer);
    clearTimeout(this.retryTimer);
  }

  /** Puts steps that failed back in front of newer ones, and queues the newest snapshot to carry them. */
  private requeue(
    failed: StepDoc[],
    list: "pushSteps" | "insertSteps",
    keys: string[],
  ): void {
    for (const key of keys) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      slot[list].unshift(...failed.filter((step) => sessionKey(step) === key));
      slot.pending = slot.latest;
    }
  }

  /** Drops the oldest queued steps once more than `maxQueuedSteps` wait for the database. */
  private trimQueuedSteps(): void {
    const queued = new Set(
      [...this.slots.values()].flatMap((slot) => [
        ...slot.pushSteps,
        ...slot.insertSteps,
      ]),
    );
    const excess = queued.size - (this.options.maxQueuedSteps ?? 2000);
    if (excess <= 0) return;
    const dropped = new Set(
      [...queued]
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .slice(0, excess),
    );
    for (const slot of this.slots.values()) {
      slot.pushSteps = slot.pushSteps.filter((step) => !dropped.has(step));
      slot.insertSteps = slot.insertSteps.filter((step) => !dropped.has(step));
    }
  }

  /** Logs the first failure of an outage and schedules another try of everything queued. */
  private reportDown(reason: unknown): void {
    if (!this.down) {
      this.down = true;
      this.options.log(
        `session write failed, queuing until it works: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      for (const slot of this.slots.values()) {
        if (slot.pending) this.schedule(slot, true);
      }
    }, this.options.retryMs ?? 5000);
    this.retryTimer.unref();
  }

  /** @param retry - True from the retry timer, the only caller allowed to write while the database is down. */
  private schedule(slot: Slot, retry = false): void {
    // A write in flight reschedules its session when it lands.
    if (slot.timer || slot.writing || (this.down && !retry)) return;
    const { flushMs, now } = this.options;
    const wait = Math.max(0, (slot.lastWriteAt ?? -Infinity) + flushMs - now());
    const attempt = () => {
      slot.timer = undefined;
      if (!slot.pending) return;
      if (this.takeToken()) this.enqueue(slot);
      else this.schedule(slot, retry);
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
    if (!slot.pending || slot.writing) return;
    slot.writing = true;
    this.batch.push({
      doc: slot.pending,
      pushSteps: slot.pushSteps,
      insertSteps: slot.insertSteps,
    });
    slot.pushSteps = [];
    slot.insertSteps = [];
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
    const steps = entries.flatMap((entry) => entry.insertSteps);
    const write = Promise.allSettled([
      this.sessions.bulkWrite(
        entries.map(({ doc, pushSteps }) => toUpdate(doc, pushSteps)),
        { ordered: false },
      ),
      steps.length > 0
        ? this.steps.insertMany(
            steps.map((step) => ({ ...step, expireAt })),
            { ordered: false },
          )
        : undefined,
    ])
      .then(([sessionsResult, stepsResult]) => {
        // A duplicate-key error on a step means an earlier attempt already stored it.
        const failedSessions = failedIndexes(sessionsResult, entries.length);
        const failedInserts = failedIndexes(stepsResult, steps.length, true);
        for (const index of failedSessions) {
          const entry = entries[index];
          this.requeue(entry.pushSteps, "pushSteps", [sessionKey(entry.doc)]);
        }
        const insertKeys = [...failedInserts].map((i) => sessionKey(steps[i]));
        this.requeue(
          [...failedInserts].map((i) => steps[i]),
          "insertSteps",
          [...new Set(insertKeys)],
        );
        this.trimQueuedSteps();
        const failure = [
          [sessionsResult, failedSessions],
          [stepsResult, failedInserts],
        ].find(([, failed]) => (failed as Set<number>).size > 0);
        if (failure) {
          this.reportDown((failure[0] as PromiseRejectedResult).reason);
          return;
        }
        if (!this.down) return;
        this.down = false;
        for (const slot of this.slots.values()) {
          if (slot.pending) this.schedule(slot);
        }
      })
      .finally(() => {
        this.writes.delete(write);
        for (const { doc } of entries) {
          const slot = this.slots.get(sessionKey(doc));
          if (!slot) continue;
          slot.writing = false;
          if (slot.pending) this.schedule(slot);
        }
      });
    this.writes.add(write);
  }
}

/**
 * The positions of the documents a settled write did not store.
 * @param result - The settled bulk write or insert.
 * @param total - How many documents it carried.
 * @param ignoreDuplicates - Whether duplicate-key errors count as stored.
 * @returns Every position when the error names no per-document failures.
 */
function failedIndexes(
  result: PromiseSettledResult<unknown> | undefined,
  total: number,
  ignoreDuplicates = false,
): Set<number> {
  if (!result || result.status === "fulfilled") return new Set();
  const { writeErrors } = (result.reason ?? {}) as {
    writeErrors?: OneOrMore<{ index: number; code: number }>;
  };
  const errors = writeErrors === undefined ? [] : [writeErrors].flat();
  if (errors.length === 0) {
    return new Set(Array.from({ length: total }, (_, index) => index));
  }
  return new Set(
    errors
      .filter((error) => !(ignoreDuplicates && error.code === 11000))
      .map((error) => error.index),
  );
}

/**
 * Builds the upsert for one session snapshot.
 * @param doc - The snapshot.
 * @param steps - Finished steps to add to the session's recent steps.
 * @returns A plain update, or an aggregation-pipeline update when steps ride along so each step id is stored once.
 */
function toUpdate(doc: SessionDoc, steps: StepDoc[]): AnyBulkWriteOperation {
  const { machineId, sessionId, startedAt, endedAt, ...rest } = doc;
  const fields = {
    ...rest,
    ...(endedAt
      ? {
          endedAt,
          expireAt: new Date(endedAt.getTime() + EXPIRY_DAYS * 86_400_000),
        }
      : {}),
  };
  const filter = { machineId, sessionId };
  // A session that no longer reports an id must lose the stored one, or the link points at a dead session.
  const absent = [
    ...(endedAt ? [] : ["endedAt", "expireAt"]),
    ...(doc.bridgeSessionId ? [] : ["bridgeSessionId"]),
    // A removed card with no fallback name must not leave its old title on the desk.
    ...(doc.deskName ? [] : ["deskName"]),
  ];
  if (steps.length === 0) {
    return {
      updateOne: {
        filter,
        update: {
          $set: fields,
          $setOnInsert: { startedAt },
          ...(absent.length
            ? { $unset: Object.fromEntries(absent.map((key) => [key, ""])) }
            : {}),
          $currentDate: { changedAt: true, lastSeenAt: true },
        } as Document,
        upsert: true,
      },
    };
  }
  const added = steps.map(({ _id, machineId, sessionId, ...step }) => ({
    id: _id.toHexString(),
    ...step,
  }));
  return {
    updateOne: {
      filter,
      update: [
        {
          // Values are literals so text such as "$HOME" is never read as a field path.
          $set: {
            ...Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [
                key,
                { $literal: value },
              ]),
            ),
            startedAt: { $ifNull: ["$startedAt", { $literal: startedAt }] },
            changedAt: "$$NOW",
            lastSeenAt: "$$NOW",
            // The session keeps its five latest-started finished steps so the office poll stays one query.
            recentSteps: {
              $slice: [
                {
                  // Sorted by start, not arrival: parallel steps finish out of order.
                  $sortArray: {
                    input: {
                      $concatArrays: [
                        {
                          // A step already stored (a retry after a lost reply) is replaced, not repeated.
                          $filter: {
                            input: { $ifNull: ["$recentSteps", []] },
                            cond: {
                              $not: {
                                $in: [
                                  "$$this.id",
                                  { $literal: added.map((step) => step.id) },
                                ],
                              },
                            },
                          },
                        },
                        { $literal: added },
                      ],
                    },
                    sortBy: { startedAt: 1, id: 1 },
                  },
                },
                -RECENT_STEPS,
              ],
            },
          },
        },
        ...(absent.length ? [{ $unset: absent }] : []),
      ],
      upsert: true,
    },
  };
}
