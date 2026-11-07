import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { officeDir, writeFileAtomic } from "../config";

export interface LaunchctlResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LaunchAgentOptions {
  home: string;
  /** The checkout the repo link points at; recorded in the plist so a moved checkout changes it and restarts the agent. */
  repoRoot: string;
  uid: number;
  /** Runs `launchctl`; never throws, so a missing job is a result and not an exception. */
  launchctl: (args: string[]) => Promise<LaunchctlResult>;
  /** Node binaries to try, in order. */
  nodeCandidates?: string[];
  /** The version a Node binary reports (`v24.1.0`), or undefined when it cannot run. */
  nodeVersion?: (path: string) => string | undefined;
  sleep?: (ms: number) => Promise<void>;
  print?: (line: string) => void;
}

export interface LaunchAgentResult {
  state: "unchanged" | "installed" | "reloaded" | "no-gui-session";
  plistPath: string;
}

export const LAUNCH_AGENT_LABEL = "dev.quanvo.claude-office.agent";

const MIN_NODE_MAJOR = 24;
// Homebrew's links survive `brew upgrade`; a versioned Cellar path or an nvm path would not.
const STABLE_NODE_PATHS = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];

function readNodeVersion(path: string): string | undefined {
  try {
    return execFileSync(path, ["-v"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The node binary the login job runs: a stable Homebrew link, else the node running setup.
 * @param candidates - Binaries to try, best first.
 * @param versionOf - Reads a binary's version.
 * @returns The first existing binary that is new enough.
 */
function pickNode(
  candidates: string[],
  versionOf: (path: string) => string | undefined,
): string {
  const tooOld: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const major = Number(versionOf(path)?.match(/^v(\d+)\./)?.[1]);
    if (major >= MIN_NODE_MAJOR) return path;
    tooOld.push(path);
  }
  throw new Error(
    tooOld.length
      ? `Node ${MIN_NODE_MAJOR} or newer is needed for the login job; found only older: ${tooOld.join(", ")}.`
      : `No node binary found for the login job (tried ${candidates.join(", ")}).`,
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The login job's plist. It holds no secrets: the file is world-readable and the connection
 * string stays in `~/.claude-office/config.json`.
 * @param home - The user's home folder.
 * @param node - The node binary.
 * @param repoRoot - The checkout the agent runs from.
 * @returns The plist text.
 */
function renderPlist(home: string, node: string, repoRoot: string): string {
  const link = join(home, ".claude", "claude-office");
  const log = join(officeDir(home), "logs", "agent.log");
  const args = [node, "--import", "tsx", join(link, "agent", "main.ts")];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(link)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CLAUDE_OFFICE_REPO</key>
    <string>${escapeXml(repoRoot)}</string>
  </dict>
</dict>
</plist>
`;
}

const UNLOAD_POLLS = 20;
const UNLOAD_POLL_MS = 250;

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Writes the plist whole or not at all, readable by everyone (it holds no secrets). */
function writePlist(plistPath: string, text: string): void {
  writeFileAtomic(plistPath, text, 0o644);
}

/**
 * Makes the office agent start at login and restart if it stops. Only `bootstrap`, `bootout` and
 * `print` are used: `load`/`unload` are deprecated and `kickstart -k` would kill a healthy agent.
 * @param options - The home folder and the injected `launchctl`.
 * @returns What was done.
 */
export async function installLaunchAgent(
  options: LaunchAgentOptions,
): Promise<LaunchAgentResult> {
  const print = options.print ?? (() => {});
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const node = pickNode(
    options.nodeCandidates ?? [...STABLE_NODE_PATHS, process.execPath],
    options.nodeVersion ?? readNodeVersion,
  );
  // Created first: launchd opens the log files itself and fails the job if the folder is missing.
  mkdirSync(join(officeDir(options.home), "logs"), {
    recursive: true,
    mode: 0o700,
  });
  const agentsDir = join(options.home, "Library", "LaunchAgents");
  mkdirSync(agentsDir, { recursive: true });
  const plistPath = join(agentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  const wanted = renderPlist(options.home, node, options.repoRoot);
  const same = readIfExists(plistPath) === wanted;

  const domain = `gui/${options.uid}`;
  const job = `${domain}/${LAUNCH_AGENT_LABEL}`;
  const isLoaded = async () =>
    (await options.launchctl(["print", job])).code === 0;

  // Over SSH with nobody at the desktop there is no gui domain to load into; keep the plist for later.
  if ((await options.launchctl(["print", domain])).code !== 0) {
    if (!same) writePlist(plistPath, wanted);
    print(
      "No desktop session to load the login job into: log in to the Mac's desktop, then re-run setup.",
    );
    return { state: "no-gui-session", plistPath };
  }

  const loaded = await isLoaded();
  if (same && loaded) return { state: "unchanged", plistPath };

  let state: LaunchAgentResult["state"] = "installed";
  if (!same) {
    // The old job must be gone before the new plist is loaded.
    const wasLoaded = loaded;
    await options.launchctl(["bootout", job]);
    if (wasLoaded) {
      state = "reloaded";
      // bootout returns before launchd has finished unloading.
      for (let i = 0; i < UNLOAD_POLLS && (await isLoaded()); i++) {
        await sleep(UNLOAD_POLL_MS);
      }
    }
    writePlist(plistPath, wanted);
  }
  const started = await options.launchctl(["bootstrap", domain, plistPath]);
  if (started.code !== 0 || !(await isLoaded())) {
    throw new Error(
      `launchctl could not load the login job: ${started.stderr.trim() || `exit ${started.code}`}`,
    );
  }
  return { state, plistPath };
}
