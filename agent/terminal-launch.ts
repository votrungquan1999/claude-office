import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

/** The files of one launch: the script, the message, the window's terminal device and claude's pid with its start time (both written by the script) and the window record (written by the agent). */
type LaunchFileExtension = "command" | "msg" | "tty" | "pid" | "window";

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
  extension: LaunchFileExtension,
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

/** The script lines that record the terminal device the window runs on and the shell's own pid with its start time, so the agent can later tell claude (which keeps the pid through `exec`) from any other process. */
function recordTty(ttyFile: string): string[] {
  const pidFile = ttyFile.replace(/\.tty$/, ".pid");
  return [
    `tty > ${shellQuote(ttyFile)}`,
    // The start time is read the way the agent reads the process table: C locale, UTC.
    `echo "$$ $(LC_ALL=C TZ=UTC ps -o lstart= -p $$)" > ${shellQuote(pidFile)}`,
  ];
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
  ttyFile?: string,
): string {
  return [
    "#!/bin/zsh",
    `cd ${shellQuote(launch.folder)} || exit 1`,
    ...(ttyFile ? recordTty(ttyFile) : []),
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
  ttyFile?: string,
): string {
  return [
    "#!/bin/zsh",
    `cd ${shellQuote(wake.folder)} || exit 1`,
    ...(ttyFile ? recordTty(ttyFile) : []),
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
  // An earlier window's device and id would pass for this window's.
  removeWindowRecord(wake.home, wake.sessionId);
  writeFileAtomic(
    script,
    buildWakeScript(wake, launchFile(wake.home, wake.sessionId, "tty")),
    0o700,
  );
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
  // An earlier window's device and id would pass for this window's.
  removeWindowRecord(launch.home, launch.sessionId);
  writeFileAtomic(messageFile, launch.message, 0o600);
  writeFileAtomic(
    script,
    buildHireScript(
      launch,
      messageFile,
      launchFile(launch.home, launch.sessionId, "tty"),
    ),
    0o700,
  );
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
 * Reads the window recorded for a launch.
 * @param home - The user's home folder.
 * @param sessionId - The session the launch started.
 * @returns The terminal device and claude's pid with its start time (as `ps` prints it) that the script wrote, and the window id the agent found for the device when it did.
 */
export function readWindowRecord(
  home: string,
  sessionId: string,
): { tty?: string; pid?: number; started?: string; windowId?: number } {
  if (!launchIdSchema.safeParse(sessionId).success) return {};
  const read = (extension: "tty" | "pid" | "window") => {
    try {
      return readFileSync(
        launchFile(home, sessionId, extension),
        "utf8",
      ).trim();
    } catch {
      return undefined;
    }
  };
  const windowId = Number(read("window"));
  // "<pid> <start time>", as the script wrote it.
  const pidMatch = /^(\d+)\s+(\S.*)$/.exec(read("pid") ?? "");
  return {
    tty: read("tty") || undefined,
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
    started: pidMatch ? pidMatch[2].replace(/\s+/g, " ").trim() : undefined,
    windowId: Number.isInteger(windowId) && windowId > 0 ? windowId : undefined,
  };
}

/**
 * Stores the id of the window found for a launch, so it survives an agent restart.
 * @param home - The user's home folder.
 * @param sessionId - The session the launch started.
 * @param windowId - The Terminal window's id.
 */
export function writeWindowRecord(
  home: string,
  sessionId: string,
  windowId: number,
): void {
  writeFileAtomic(
    launchFile(home, sessionId, "window"),
    String(windowId),
    0o600,
  );
}

/**
 * Deletes the window record of a launch.
 * @param home - The user's home folder.
 * @param sessionId - The session the launch started.
 */
export function removeWindowRecord(home: string, sessionId: string): void {
  if (!launchIdSchema.safeParse(sessionId).success) return;
  for (const extension of ["tty", "pid", "window"] as const) {
    rmSync(launchFile(home, sessionId, extension), { force: true });
  }
}

/**
 * Deletes every launch script and message at start-up (nothing a previous run left can still be waiting to open), and the window records of sessions that are not kept desks.
 * @param home - The user's home folder.
 * @param isKept - Whether a session is a kept desk, whose window records a later Dismiss still needs.
 */
export function sweepLaunchFiles(
  home: string,
  isKept: (sessionId: string) => boolean,
): void {
  const dir = launchDir(home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.endsWith(".command") || name.endsWith(".msg")) {
      rmSync(join(dir, name), { force: true });
      continue;
    }
    // Only a kept desk can be dismissed, so only its window records still have a use.
    const record = /^(.+)\.(tty|pid|window)$/.exec(name);
    if (record && !isKept(record[1])) rmSync(join(dir, name), { force: true });
  }
}

/**
 * Whether a command line is the claude binary started for one session by a hire (`--session-id`) or a wake (`--resume`).
 * Only the options before the first `--` count: the hire's first message follows it and can say anything.
 * @param args - The process's command line.
 * @param sessionId - The session.
 * @param claudePath - The claude binary the agent launches.
 * @returns True only for that very command.
 */
export function isLaunchOf(
  args: string,
  sessionId: string,
  claudePath: string,
): boolean {
  // A binary with another name (`vim --resume ID`) is never ours.
  if (args !== claudePath && !args.startsWith(`${claudePath} `)) return false;
  const tokens = args.slice(claudePath.length).trim().split(/\s+/);
  const options = tokens.slice(
    0,
    tokens.indexOf("--") === -1 ? undefined : tokens.indexOf("--"),
  );
  return options.some(
    (token, index) =>
      (token === "--session-id" || token === "--resume") &&
      options[index + 1] === sessionId,
  );
}
