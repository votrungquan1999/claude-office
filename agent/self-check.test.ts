import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReplSet } from "@/test/create-repl-set";
import { capLogFile } from "./log-cap";
import { type RunningAgent, startAgent } from "./start-agent";
import { makeFakeHome } from "./test/fake-home";

const MINUTE = 60_000;

describe("the agent giving up when it cannot write", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** An agent on its own database, so the test can take that database away. */
  async function startOnOwnDatabase() {
    const replSet = await createReplSet();
    cleanups.push(() => replSet.stop().then(() => {}));
    const fake = makeFakeHome("m-stale");
    cleanups.push(() => fake.remove());
    // A short selection timeout so a write to the vanished database fails fast.
    const uri = new URL(replSet.getUri());
    uri.searchParams.set("serverSelectionTimeoutMS", "500");
    let clock = Date.parse("2026-11-08T10:00:00.000Z");
    const onStale = vi.fn();
    const agent: RunningAgent = await startAgent({
      home: fake.home,
      mongo: { uri: uri.toString(), db: "stale-test" },
      computerName: "Stale Mac",
      now: () => clock,
      onStale,
      log: () => {},
    });
    cleanups.push(() => agent.stop());
    return {
      agent,
      onStale,
      replSet,
      // Checks run every 30 seconds as the agent's timer does, so a jump is not mistaken for a sleep.
      advance: (ms: number) => {
        for (let left = ms; left > 0; left -= 30_000) {
          clock += Math.min(30_000, left);
          agent.checkWriteHealth();
        }
      },
    };
  }

  it("gives up after five minutes without a successful write, so the login job restarts it", async () => {
    // Given a running agent whose database then disappears
    const { agent, onStale, replSet, advance } = await startOnOwnDatabase();
    await replSet.stop();

    // When a heartbeat fails three minutes later and a minute after that the check runs
    advance(3 * MINUTE);
    await agent.heartbeat();
    advance(1 * MINUTE);
    agent.checkWriteHealth();

    // Then it keeps waiting
    expect(onStale).not.toHaveBeenCalled();

    // When it passes five minutes since the last good write, the failed heartbeat not counting
    advance(2 * MINUTE);
    agent.checkWriteHealth();

    // Then it gives up exactly once, even if checked again
    agent.checkWriteHealth();
    expect(onStale).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("stays up while heartbeats keep landing, and counts the five minutes from the last one", async () => {
    // Given a healthy agent
    const { agent, onStale, advance } = await startOnOwnDatabase();

    // When a heartbeat lands after four minutes and four more minutes pass
    advance(4 * MINUTE);
    await agent.heartbeat();
    advance(4 * MINUTE);
    agent.checkWriteHealth();

    // Then eight minutes since start is not stale, because the last write was four minutes ago
    expect(onStale).not.toHaveBeenCalled();

    // When it has been five minutes since that heartbeat
    advance(1.5 * MINUTE);
    agent.checkWriteHealth();
    expect(onStale).toHaveBeenCalledTimes(1);
  }, 120_000);
});

describe("the agent's log size", () => {
  it("is emptied at start when it passed the cap, and left alone otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-office-log-"));
    try {
      const big = join(dir, "big.log");
      const small = join(dir, "small.log");
      writeFileSync(big, "x".repeat(2000));
      writeFileSync(small, "x".repeat(500));

      expect(capLogFile(big, 1000)).toBe(true);
      expect(capLogFile(small, 1000)).toBe(false);
      expect(capLogFile(join(dir, "missing.log"), 1000)).toBe(false);

      expect(statSync(big).size).toBe(0);
      expect(statSync(small).size).toBe(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
