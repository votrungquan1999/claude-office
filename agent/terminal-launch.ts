import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { officeDir, writeFileAtomic } from "./config";

/** Opens a script in a new Terminal window; injected so tests never open one. */
export type TerminalOpener = (scriptPath: string) => Promise<void>;

export interface HireLaunch {
  home: string;
  sessionId: string;
  folder: string;
  claudePath: string;
  message: string;
}

const run = promisify(execFile);

/**
 * Opens a script in a new macOS Terminal window.
 * @param scriptPath - A `.command` file.
 */
export const openInTerminal: TerminalOpener = async (scriptPath) => {
  await run("/usr/bin/open", ["-a", "Terminal", scriptPath]);
};

/** Where launch scripts and messages live; private to the user. */
function launchDir(home: string): string {
  return join(officeDir(home), "launch");
}

// Any 8-4-4-4-12 hex id: Claude Code names sessions with UUIDs, and only the shape keeps a file name safe.
const launchIdSchema = z.guid();

/**
 * The path of one launch file; only a UUID may name it, so an id can never reach outside the launch folder.
 * @param home - The user's home folder.
 * @param sessionId - The session the launch starts.
 * @param extension - `command` or `msg`.
 * @returns The file's path.
 */
function launchFile(
  home: string,
  sessionId: string,
  extension: "command" | "msg",
): string {
  return join(
    launchDir(home),
    `${launchIdSchema.parse(sessionId)}.${extension}`,
  );
}

/** Single-quotes a value for zsh, so a space or quote in a folder name cannot break out. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** A zsh word for a session id: bare when it is plain, quoted otherwise. */
function idWord(sessionId: string): string {
  return /^[\w-]+$/.test(sessionId) ? sessionId : shellQuote(sessionId);
}

/**
 * The script a hired window runs; the message is read from its own file, which the script then deletes, and is never written here.
 * @param launch - The hire.
 * @param messageFile - Where the message was stored.
 * @returns The script text.
 */
export function buildHireScript(
  launch: Pick<HireLaunch, "sessionId" | "folder" | "claudePath">,
  messageFile: string,
): string {
  return [
    "#!/bin/zsh",
    `cd ${shellQuote(launch.folder)} || exit 1`,
    `msg=$(cat ${shellQuote(messageFile)})`,
    // The message is private, so it leaves the disk the moment it is read.
    `rm -f ${shellQuote(messageFile)}`,
    // The `--` keeps a message that starts with "-" from being read as an option.
    `exec ${shellQuote(launch.claudePath)} --remote-control --session-id ${idWord(launch.sessionId)} -- "$msg"`,
    "",
  ].join("\n");
}

/**
 * The script a woken window runs: it resumes the conversation in the folder it started in.
 * @param wake - The conversation, its start folder and the claude binary.
 * @returns The script text.
 */
export function buildWakeScript(
  wake: Pick<HireLaunch, "sessionId" | "folder" | "claudePath">,
): string {
  return [
    "#!/bin/zsh",
    `cd ${shellQuote(wake.folder)} || exit 1`,
    `exec ${shellQuote(wake.claudePath)} --resume ${idWord(wake.sessionId)} --remote-control`,
    "",
  ].join("\n");
}

/**
 * Writes the private script of a wake.
 * @param wake - The conversation to resume.
 * @returns The path of the script to open.
 */
export function writeWakeFile(
  wake: Pick<HireLaunch, "home" | "sessionId" | "folder" | "claudePath">,
): string {
  const script = launchFile(wake.home, wake.sessionId, "command");
  mkdirSync(launchDir(wake.home), { recursive: true, mode: 0o700 });
  writeFileAtomic(script, buildWakeScript(wake), 0o700);
  return script;
}

/**
 * Writes the private script and message files of a hire.
 * @param launch - The hire.
 * @returns The path of the script to open.
 */
export function writeHireFiles(launch: HireLaunch): string {
  const messageFile = launchFile(launch.home, launch.sessionId, "msg");
  const script = launchFile(launch.home, launch.sessionId, "command");
  mkdirSync(launchDir(launch.home), { recursive: true, mode: 0o700 });
  writeFileAtomic(messageFile, launch.message, 0o600);
  writeFileAtomic(script, buildHireScript(launch, messageFile), 0o700);
  return script;
}

/**
 * Deletes the script and message of one launch.
 * @param home - The user's home folder.
 * @param sessionId - The session the launch started.
 */
export function removeLaunchFiles(home: string, sessionId: string): void {
  // An id that is no UUID never named a launch file.
  if (!launchIdSchema.safeParse(sessionId).success) return;
  for (const extension of ["command", "msg"] as const) {
    rmSync(launchFile(home, sessionId, extension), { force: true });
  }
}

/**
 * Deletes every launch file at start-up: nothing a previous run left can still be waiting to open.
 * @param home - The user's home folder.
 */
export function sweepLaunchFiles(home: string): void {
  const dir = launchDir(home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) rmSync(join(dir, name), { force: true });
}
