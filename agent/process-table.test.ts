import { describe, expect, it } from "vitest";
import { parseProcessTable } from "./reconcile";

describe("reading the process table", () => {
  it("spells a process with no terminal ?? on macOS and on Linux, and keeps a real device", () => {
    // Given ps output from macOS (??), Linux (?) and a process on a terminal
    const stdout = [
      "  101     1 ??       Wed Nov 18 05:22:41 2026 node /daemon.js",
      "  102     1 ?        Wed Nov 18 05:22:42 2026 node /runner.js",
      "  103   102 ttys003  Wed Nov 18 05:22:43 2026 claude --resume",
    ].join("\n");

    // When the agent reads it
    const table = parseProcessTable(stdout);

    // Then both terminal-less processes read ?? and the device stays as printed
    expect([...table].map(([pid, info]) => [pid, info.tty])).toEqual([
      [101, "??"],
      [102, "??"],
      [103, "ttys003"],
    ]);
  });
});
