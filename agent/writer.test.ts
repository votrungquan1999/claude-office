import { type Collection, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionDoc, SessionWriter, type StepDoc } from "./writer";

const NO_STEPS = { insertMany: vi.fn() } as unknown as Collection;

function doc(cwd: string, sessionId = "s1"): SessionDoc {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd,
    state: "idle",
    startedAt: new Date(0),
  };
}

interface RecordedOp {
  updateOne: {
    update:
      | { $set: { cwd: string } }
      | [{ $set: Record<string, unknown> }, ...unknown[]];
  };
}

/** The cwds in one recorded bulkWrite call, whether the update is a plain one or a pipeline. */
function writtenCwds(call: unknown[] | undefined): string[] {
  const ops = (call?.[0] ?? []) as RecordedOp[];
  return ops.map(({ updateOne: { update } }) =>
    Array.isArray(update)
      ? (update[0].$set.cwd as { $literal: string }).$literal
      : update.$set.cwd,
  );
}

describe("the session writer's write budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes a session at once, then at most once per window without postponing a busy session forever", async () => {
    // Given a writer with a 1 s window over a collection that records its bulk writes
    const bulkWrite = vi.fn().mockResolvedValue({});
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      NO_STEPS,
      {
        flushMs: 1000,
        maxOpsPerSecond: 100,
        now: () => Date.now(),
        log: () => {},
      },
    );

    // When a session changes every 100 ms for 2.5 s
    writer.submit(doc("/a/0"));
    await vi.advanceTimersByTimeAsync(0);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(writtenCwds(bulkWrite.mock.calls[0])).toEqual(["/a/0"]);
    for (let step = 1; step <= 25; step++) {
      await vi.advanceTimersByTimeAsync(100);
      writer.submit(doc(`/a/${step}`));
    }
    await vi.advanceTimersByTimeAsync(1000);

    // Then it was written straight away and about once per second after, not held until the changes stopped
    expect(bulkWrite.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(bulkWrite.mock.calls.length).toBeLessThanOrEqual(4);
    expect(writtenCwds(bulkWrite.mock.calls.at(-1))).toEqual(["/a/25"]);
    writer.stop();
  });

  it("caps writes per second across sessions without dropping any", async () => {
    // Given a writer that allows 10 writes per second
    const bulkWrite = vi.fn().mockResolvedValue({});
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      NO_STEPS,
      {
        flushMs: 1000,
        maxOpsPerSecond: 10,
        now: () => Date.now(),
        log: () => {},
      },
    );

    // When 30 different sessions change in the same tick
    for (let n = 0; n < 30; n++) writer.submit(doc("/a", `s${n}`));
    await vi.advanceTimersByTimeAsync(0);

    // Then at most 10 are written straight away
    const written = () => bulkWrite.mock.calls.flatMap(writtenCwds).length;
    expect(written()).toBeLessThanOrEqual(10);

    // When time passes
    await vi.advanceTimersByTimeAsync(3500);

    // Then all 30 end up written
    expect(written()).toBe(30);
    writer.stop();
  });

  it("skips a write when the snapshot is unchanged", async () => {
    // Given a session already written
    const bulkWrite = vi.fn().mockResolvedValue({});
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      NO_STEPS,
      {
        flushMs: 1000,
        maxOpsPerSecond: 100,
        now: () => Date.now(),
        log: () => {},
      },
    );
    writer.submit(doc("/a"));
    await vi.advanceTimersByTimeAsync(5000);

    // When the same snapshot is submitted again
    writer.submit(doc("/a"));
    await vi.advanceTimersByTimeAsync(5000);

    // Then nothing more is written
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    writer.stop();
  });

  it("keeps the latest snapshot and the newest steps while the database is unreachable, and delivers them once it is back", async () => {
    // Given a writer whose database cannot be reached, holding at most 3 steps back
    let up = false;
    // Only calls made while the database is up count as delivered.
    const delivered = { cwds: [] as string[], steps: [] as string[] };
    const bulkWrite = vi.fn(async (ops: unknown[]) => {
      if (!up) throw new Error("unreachable");
      delivered.cwds.push(...writtenCwds([ops]));
    });
    const insertMany = vi.fn(async (docs: StepDoc[]) => {
      if (!up) throw new Error("unreachable");
      delivered.steps.push(...docs.map((d) => d.text));
    });
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      { insertMany } as unknown as Collection,
      {
        flushMs: 1000,
        maxOpsPerSecond: 100,
        now: () => Date.now(),
        log: () => {},
        retryMs: 5000,
        maxQueuedSteps: 3,
      },
    );
    const step = (n: number): StepDoc => ({
      _id: new ObjectId(),
      machineId: "m1",
      sessionId: "s1",
      text: `step ${n}`,
      startedAt: new Date(n * 1000),
      status: "ok",
    });

    // When the session changes and finishes five steps during the outage
    writer.submit(doc("/a/1"), [step(1), step(2)]);
    await vi.advanceTimersByTimeAsync(0);
    writer.submit(doc("/a/2"), [step(3), step(4), step(5)]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(bulkWrite).toHaveBeenCalled();

    // And the database comes back
    up = true;
    await vi.advanceTimersByTimeAsync(10_000);

    // Then the latest snapshot and the newest three steps arrive without anything submitting again
    expect(delivered.cwds).toEqual(["/a/2"]);
    expect(delivered.steps).toEqual(["step 3", "step 4", "step 5"]);
    writer.stop();
  });
  const stepDoc = (n: number, sessionId = "s1"): StepDoc => ({
    _id: new ObjectId(),
    machineId: "m1",
    sessionId,
    text: `step ${n}`,
    startedAt: new Date(n * 1000),
    status: "ok",
  });

  /** Step texts one bulkWrite's operations add to recentSteps (the pipeline's literal list of new steps). */
  function pushedTexts(ops: unknown[]): string[] {
    return (ops as RecordedOp[]).flatMap(({ updateOne: { update } }) => {
      if (!Array.isArray(update)) return [];
      const recent = update[0].$set.recentSteps as {
        $slice: [
          { $sortArray: { input: { $concatArrays: [unknown, unknown] } } },
        ];
      };
      const added = recent.$slice[0].$sortArray.input.$concatArrays[1] as {
        $literal: Array<{ text: string }>;
      };
      return added.$literal.map((step) => step.text);
    });
  }

  function duplicateKeyError(indexes: number[]) {
    return Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      writeErrors: indexes.map((index) => ({ index, code: 11000 })),
    });
  }

  const options = {
    flushMs: 1000,
    maxOpsPerSecond: 100,
    now: () => Date.now(),
    log: () => {},
    retryMs: 5000,
  };

  it("never lets an older snapshot overwrite a newer one when the first write's failure is only reported after the second snapshot was submitted", async () => {
    // Given a database that is down, whose failures are reported only when the test says so
    let up = false;
    const failures: Array<(error: Error) => void> = [];
    const stored: string[] = [];
    const bulkWrite = vi.fn((ops: unknown[]) => {
      if (up) {
        stored.push(...writtenCwds([ops]));
        return Promise.resolve({});
      }
      return new Promise((_, reject) => failures.push(reject));
    });
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      NO_STEPS,
      options,
    );

    // When a second snapshot is submitted one window after the first, whose write is unanswered
    writer.submit(doc("/a/1"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    writer.submit(doc("/a/2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(bulkWrite).toHaveBeenCalledTimes(1);

    // And the database comes back, then both failures are reported oldest first
    up = true;
    for (const fail of failures) fail(new Error("unreachable"));
    await vi.advanceTimersByTimeAsync(20_000);

    // Then the newest snapshot is the last one the database received
    expect(stored.at(-1)).toBe("/a/2");
    writer.stop();
  });

  it("recovers when step inserts landed but their reply was lost, without pushing any step onto the session twice", async () => {
    // Given an insert that stores its steps and then fails, and a retry that reports each as a duplicate
    const inserted = new Set<StepDoc>();
    const pushed: string[] = [];
    let insertCalls = 0;
    const bulkWrite = vi.fn(async (ops: unknown[]) => {
      pushed.push(...pushedTexts(ops));
    });
    const insertMany = vi.fn(async (docs: StepDoc[]) => {
      insertCalls++;
      const duplicates = docs.flatMap((d, i) => {
        const dup = [...inserted].some((x) => x._id.equals(d._id));
        inserted.add(d);
        return dup ? [i] : [];
      });
      if (insertCalls === 1) throw new Error("reply lost");
      if (duplicates.length > 0) throw duplicateKeyError(duplicates);
    });
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      { insertMany } as unknown as Collection,
      options,
    );

    // When a session finishes two steps and the retries run
    writer.submit(doc("/a"), [stepDoc(1), stepDoc(2)]);
    await vi.advanceTimersByTimeAsync(60_000);

    // Then the writer stopped retrying, and each step went onto the session once
    expect(insertCalls).toBe(2);
    expect(pushed).toEqual(["step 1", "step 2"]);
    writer.stop();
  });

  it("retries only what failed when the session write fails but the step insert succeeds", async () => {
    // Given a session write that fails once while the step insert works
    let sessionFailures = 1;
    const pushed: string[] = [];
    const bulkWrite = vi.fn(async (ops: unknown[]) => {
      if (sessionFailures-- > 0) throw new Error("unreachable");
      pushed.push(...pushedTexts(ops));
    });
    const insertMany = vi.fn(async () => {});
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      { insertMany } as unknown as Collection,
      options,
    );

    // When a session finishes two steps
    writer.submit(doc("/a"), [stepDoc(1), stepDoc(2)]);
    await vi.advanceTimersByTimeAsync(60_000);

    // Then the steps are inserted once and still reach the session's recent steps
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(pushed).toEqual(["step 1", "step 2"]);
    writer.stop();
  });

  it("sends no second write for a session while its previous write is still in flight, then sends the newest snapshot", async () => {
    // Given a first write that takes longer than the write window
    let finishFirst: () => void = () => {};
    const bulkWrite = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValue({});
    const writer = new SessionWriter(
      { bulkWrite } as unknown as Collection,
      NO_STEPS,
      options,
    );

    // When a newer snapshot is submitted and a full window passes while the first write is unanswered
    writer.submit(doc("/a/old"));
    await vi.advanceTimersByTimeAsync(0);
    writer.submit(doc("/a/new"));
    await vi.advanceTimersByTimeAsync(3000);

    // Then nothing overtakes the first write
    expect(bulkWrite).toHaveBeenCalledTimes(1);

    // When the first write lands
    finishFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    // Then the newest snapshot goes out after it
    expect(bulkWrite).toHaveBeenCalledTimes(2);
    expect(writtenCwds(bulkWrite.mock.calls[1])).toEqual(["/a/new"]);
    writer.stop();
  });
});
