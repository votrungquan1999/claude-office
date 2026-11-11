import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOfficeHookEntries } from "./hook-entries";

const EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "Stop",
  "StopFailure",
  "Elicitation",
  "ElicitationResult",
  "SubagentStart",
  "SubagentStop",
];

describe("the office hook entries", () => {
  it("covers every event with an async command that never asks Claude Code for a decision", () => {
    // When the entries are built for a home folder
    const entries = buildOfficeHookEntries("/Users/q");

    // Then each of the 15 events has one async command hook, with nothing else that could block or decide
    expect(Object.keys(entries).sort()).toEqual([...EVENTS].sort());
    for (const event of EVENTS) {
      expect(entries[event]).toEqual({
        hooks: [
          {
            type: "command",
            command:
              "node '/Users/q/.claude/claude-office/hooks/claude-office-hook.mjs' 2>/dev/null || true",
            async: true,
          },
        ],
      });
    }
  });

  it("never fails or prints when the script is missing, even under a home folder with spaces", () => {
    // Given a home folder with a space whose office link does not exist, and no way to find node
    const base = mkdtempSync(join(tmpdir(), "claude office "));
    try {
      const { command } = buildOfficeHookEntries(base).Stop.hooks[0];

      // When Claude Code's shell runs the command
      const ran = spawnSync("sh", ["-c", command], {
        encoding: "utf8",
        env: { ...process.env, PATH: "/usr/bin:/bin" },
      });

      // Then it exits 0 and says nothing, so the session sees no hook error
      expect(ran.status).toBe(0);
      expect(ran.stderr).toBe("");
      expect(ran.stdout).toBe("");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
