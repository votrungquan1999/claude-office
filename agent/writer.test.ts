import type { Collection } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionDoc, SessionWriter } from "./writer";

function doc(cwd: string, sessionId = "s1"): SessionDoc {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd,
    state: "waiting",
    startedAt: new Date(0),
  };
}

/** The cwds in one recorded bulkWrite call. */
function writtenCwds(call: unknown[] | undefined): string[] {
  const ops = (call?.[0] ?? []) as Array<{
    updateOne: { update: { $set: { cwd: string } } };
  }>;
  return ops.map((op) => op.updateOne.update.$set.cwd);
}

describe("the session writer's write budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes a session at once, then at most once per window without postponing a busy session forever", async () => {
    // Given a writer with a 1 s window over a collection that records its bulk writes
    const bulkWrite = vi.fn().mockResolvedValue({});
    const writer = new SessionWriter({ bulkWrite } as unknown as Collection, {
      flushMs: 1000,
      maxOpsPerSecond: 100,
      now: () => Date.now(),
      log: () => {},
    });

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
    const writer = new SessionWriter({ bulkWrite } as unknown as Collection, {
      flushMs: 1000,
      maxOpsPerSecond: 10,
      now: () => Date.now(),
      log: () => {},
    });

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
    const writer = new SessionWriter({ bulkWrite } as unknown as Collection, {
      flushMs: 1000,
      maxOpsPerSecond: 100,
      now: () => Date.now(),
      log: () => {},
    });
    writer.submit(doc("/a"));
    await vi.advanceTimersByTimeAsync(5000);

    // When the same snapshot is submitted again
    writer.submit(doc("/a"));
    await vi.advanceTimersByTimeAsync(5000);

    // Then nothing more is written
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    writer.stop();
  });
});
