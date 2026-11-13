import { describe, expect, it } from "vitest";
import { endConversation, strayOnTty } from "./end-conversation";
import type { ProcessTable } from "./reconcile";
import { useLiveProcesses } from "./test/live-process";

/** Whether a process still exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const STARTED = "Mon Nov  9 10:00:00 2026";
const entry = (ppid: number, tty: string, args: string) => ({
  ppid,
  tty,
  args,
  started: STARTED,
});

describe("what a dismiss sweeps off a window's terminal", () => {
  it("is everything on the device except the login shell and login, and never another device, a process with no terminal, init or the agent itself", () => {
    // Given a table with the window's shell, a leftover, other devices and system processes
    const table: ProcessTable = new Map([
      [1, entry(0, "ttys003", "/sbin/launchd")],
      [100, entry(1, "ttys003", "login -pf q")],
      [101, entry(100, "ttys003", "-zsh")],
      [102, entry(101, "ttys003", "node /work/mcp-server.js")],
      [103, entry(101, "ttys003", "/usr/bin/vim notes.txt")],
      [200, entry(1, "ttys004", "node /other/window.js")],
      [300, entry(1, "??", "node /daemon.js")],
      [process.pid, entry(1, "ttys003", "node agent")],
    ]);

    // When the sweep chooses for the device in either spelling
    const pids = (tty: string) => strayOnTty(table, tty).map((p) => p.pid);

    // Then only the leftovers on that device are chosen
    expect(pids("/dev/ttys003")).toEqual([102, 103]);
    expect(pids("ttys003")).toEqual([102, 103]);

    // And a device that is no terminal chooses nothing
    expect(pids("??")).toEqual([]);
  });
});

const GRACE_MS = 1500;
const CHILDREN = 3;

describe("ending a conversation whose children ignore SIGTERM", () => {
  const processes = useLiveProcesses();

  it("gives every child the same grace at once and moves on after SIGKILL, so the whole ending takes one grace and not one per child", async () => {
    // Given a conversation and three children that survive SIGTERM
    const conversation = await processes.standIn();
    const children = await Promise.all(
      Array.from({ length: CHILDREN }, () =>
        processes.standIn({ ignoreTerm: true }),
      ),
    );

    // When the conversation is ended with a 1.5 s grace
    const started = Date.now();
    await endConversation(
      { pid: conversation.pid, started: conversation.procStart },
      children.map((child) => ({ pid: child.pid, started: child.procStart })),
      { termGraceMs: GRACE_MS, childGraceMs: GRACE_MS, pollMs: 20 },
    );
    const took = Date.now() - started;

    // Then it took less than the sequential lower bound, one full grace per child
    // A load-proof ceiling: signalling the children one after another cannot finish before this.
    expect(took).toBeLessThan(CHILDREN * GRACE_MS);

    // And every child is gone shortly after
    for (
      let tries = 0;
      tries < 50 && children.some((c) => isAlive(c.pid));
      tries++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(children.some((child) => isAlive(child.pid))).toBe(false);
    expect(isAlive(conversation.pid)).toBe(false);
  }, 30_000);
});
