import { describe, expect, it, vi } from "vitest";
import { createWriteWatchdog } from "./write-watchdog";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe("the write watchdog across a Mac sleep", () => {
  function setUp() {
    let clock = 0;
    const onStale = vi.fn();
    const watchdog = createWriteWatchdog({
      now: () => clock,
      limitMs: 5 * MINUTE,
      onStale,
    });
    return {
      watchdog,
      onStale,
      /** Time passes with a check every 30 seconds, as the agent's timer does. */
      tick: (ms: number) => {
        for (let left = ms; left > 0; left -= 30 * SECOND) {
          clock += Math.min(30 * SECOND, left);
          watchdog.check();
        }
      },
      /** The clock jumps while no check can run, as when the Mac sleeps. */
      sleep: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("does not give up when the clock jumped past the limit while the Mac slept", () => {
    // Given an agent whose last write was a minute ago
    const { watchdog, onStale, tick, sleep } = setUp();
    watchdog.markWrite();
    tick(1 * MINUTE);

    // When the Mac sleeps for eight hours and wakes with its first check
    sleep(8 * 60 * MINUTE);
    watchdog.check();

    // Then it does not count the sleep as a failed-write period
    expect(onStale).not.toHaveBeenCalled();

    // And it still gives up once five real minutes pass with no write
    tick(4 * MINUTE);
    expect(onStale).not.toHaveBeenCalled();
    tick(2 * MINUTE);
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});
