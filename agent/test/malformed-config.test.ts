import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("the agent with a malformed saved connection", () => {
  let home = "";
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("exits non-zero with one clear line that names the fix, not a stack trace", () => {
    // Given a config.json that is not valid JSON
    home = mkdtempSync(join(tmpdir(), "office-badcfg-"));
    mkdirSync(join(home, ".claude-office"));
    writeFileSync(join(home, ".claude-office", "config.json"), "{ not json");

    // When the agent starts
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "agent/main.ts"],
      {
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    // Then it stops with a single line pointing at the reconnect command
    expect(run.status).toBe(1);
    const lines = run.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("npm run setup -- --reconnect");
  });
});
