import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeSession {
  sessionId: string;
  cwd: string;
  kind?: string;
  name?: string;
  /** The process behind the session; defaults to a made-up one that does not exist. */
  pid?: number;
  /** `ps -o lstart` text of that process. */
  procStart?: string;
  status?: "idle" | "busy" | "waiting";
  startedAt?: number;
  statusUpdatedAt?: number;
  /** Leaves `statusUpdatedAt` out of the entry, as an older Claude Code does. */
  withoutStatusTime?: boolean;
  /** Remote Control id Claude Code writes while Remote Control is connected. */
  bridgeSessionId?: string;
}

export interface FakeHome {
  home: string;
  /** Writes a `~/.claude/sessions/<pid>.json` registry entry for a made-up running session. */
  addSession(session: FakeSession): void;
  /** Rewrites fields of a session's registry entry, as Claude Code does when its status changes. */
  updateSession(sessionId: string, patch: Partial<FakeSession>): void;
  /** Deletes a session's registry entry. */
  removeSession(sessionId: string): void;
  /** Writes `~/.claude/projects/<project>/<sessionId>.jsonl`; strings are written as-is. */
  addTranscript(
    sessionId: string,
    records: Array<object | string>,
    project?: string,
  ): void;
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
  const files = new Map<string, string>();
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ machineID: machineId }),
  );
  return {
    home,
    addSession(session) {
      const pid = session.pid ?? nextPid++;
      const entry = {
        pid,
        sessionId: session.sessionId,
        cwd: session.cwd,
        startedAt: session.startedAt ?? 1_700_000_000_000,
        procStart: session.procStart ?? "Mon Nov  6 08:00:00 2026",
        status: session.status ?? "idle",
        ...(session.withoutStatusTime
          ? {}
          : {
              statusUpdatedAt: session.statusUpdatedAt ?? 1_700_000_000_000,
            }),
        kind: session.kind ?? "interactive",
        name: session.name ?? "made-up",
        bridgeSessionId: session.bridgeSessionId,
        // Keys Claude Code writes that the agent does not use.
        pidDomain: "darwin",
        peerProtocol: 1,
      };
      const file = join(sessionsDir, `${pid}.json`);
      files.set(session.sessionId, file);
      writeFileSync(file, JSON.stringify(entry));
      // Claude Code keeps a secret next to each entry; the agent must never read it.
      writeFileSync(
        join(sessionsDir, `${pid}.a1b2c3.key`),
        JSON.stringify({ ...entry, name: "REGISTRY_KEY_SECRET_9d2e" }),
      );
    },
    updateSession(sessionId, patch) {
      const file = files.get(sessionId);
      if (!file) throw new Error(`no registry entry for ${sessionId}`);
      writeFileSync(
        file,
        JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }),
      );
    },
    removeSession(sessionId) {
      rmSync(files.get(sessionId) ?? "", { force: true });
    },
    addTranscript(sessionId, records, project = "-work-project") {
      const dir = join(home, ".claude", "projects", project);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${sessionId}.jsonl`),
        `${records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n")}\n`,
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
