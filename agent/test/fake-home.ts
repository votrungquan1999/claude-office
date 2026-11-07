import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeSession {
  sessionId: string;
  cwd: string;
  kind?: string;
  name?: string;
}

export interface FakeHome {
  home: string;
  /** Writes a `~/.claude/sessions/<pid>.json` registry entry for a made-up running session. */
  addSession(session: FakeSession): void;
  /** Writes `~/.claude/kanban-session-state/<sessionId>.json`; a string is written as-is (to fake a half-written file). */
  writeKanban(sessionId: string, content: object | string): void;
  removeKanban(sessionId: string): void;
  remove(): void;
}

let nextPid = 40_000;

/**
 * A throwaway `$HOME` with a made-up `~/.claude` tree, so no test ever reads or writes the real one.
 * @param machineId - The `machineID` stored in `~/.claude.json`.
 * @returns The home folder and helpers to populate it.
 */
export function makeFakeHome(machineId: string): FakeHome {
  const home = mkdtempSync(join(tmpdir(), "claude-office-home-"));
  const sessionsDir = join(home, ".claude", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const kanbanDir = join(home, ".claude", "kanban-session-state");
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ machineID: machineId }),
  );
  return {
    home,
    addSession({ sessionId, cwd, kind = "interactive", name = "made-up" }) {
      const pid = nextPid++;
      writeFileSync(
        join(sessionsDir, `${pid}.json`),
        JSON.stringify({
          pid,
          sessionId,
          cwd,
          startedAt: 1_700_000_000_000,
          procStart: "Mon Nov  6 08:00:00 2026",
          status: "idle",
          statusUpdatedAt: 1_700_000_000_000,
          kind,
          name,
        }),
      );
    },
    writeKanban(sessionId, content) {
      mkdirSync(kanbanDir, { recursive: true });
      writeFileSync(
        join(kanbanDir, `${sessionId}.json`),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    },
    removeKanban(sessionId) {
      rmSync(join(kanbanDir, `${sessionId}.json`), { force: true });
    },
    remove() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
