import { execFile } from "node:child_process";

/** What the agent says about the code it runs, on every heartbeat. */
export interface AgentCodeReport {
  /** Short commit of the code the agent loaded; absent when the checkout is not a readable git repo. */
  agentCommit?: string;
  /** The checkout holds newer code the agent loads than the code it loaded. */
  restartNeeded: boolean;
}

/** Tells the owner when the agent runs older code than its checkout holds. */
export interface AgentCodeWatch {
  /** Re-reads the checkout and says what the agent loaded and whether a restart is needed. */
  check(): Promise<AgentCodeReport>;
}

/** Paths whose change means the running agent is out of date: everything it imports, and its dependencies. */
const AGENT_CODE_PATHS = [
  "agent",
  "src/shared",
  "src/db",
  "package.json",
  "package-lock.json",
];

const GIT_TIMEOUT_MS = 3000;

/**
 * Runs one read-only git command in the checkout.
 * @param repoDir - The checkout.
 * @param args - git's arguments.
 * @returns Its trimmed output, or undefined when git failed or timed out.
 */
function runGit(repoDir: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      // No index lock, so a check never blocks the owner's own git commands.
      ["--no-optional-locks", ...args],
      { cwd: repoDir, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => resolve(error ? undefined : stdout.trim()),
    );
  });
}

/**
 * Whether a commit is missing from the checkout, as git answers it; a git that timed out or could not run says nothing.
 * @param repoDir - The checkout.
 * @param commit - The commit to look for.
 * @returns True when git ran and found no such commit.
 */
function isCommitGone(repoDir: string, commit: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--no-optional-locks", "cat-file", "-e", `${commit}^{commit}`],
      { cwd: repoDir, timeout: GIT_TIMEOUT_MS },
      (error) => resolve(typeof error?.code === "number" && !error.killed),
    );
  });
}

/**
 * Whether the code between two commits changes anything the agent loads.
 * @param repoDir - The checkout.
 * @param from - The commit the agent loaded.
 * @param to - The checkout's current commit.
 * @returns True when it does or the loaded commit is gone from the checkout; undefined when git failed for another reason, such as a timeout.
 */
async function changesAgentCode(
  repoDir: string,
  from: string,
  to: string,
): Promise<boolean | undefined> {
  const changed = await runGit(repoDir, [
    "diff",
    "--name-only",
    from,
    to,
    "--",
    ...AGENT_CODE_PATHS,
  ]);
  if (changed !== undefined) return changed !== "";
  return (await isCommitGone(repoDir, from)) ? true : undefined;
}

/**
 * Records the commit the agent loaded at start, to compare the checkout against on each heartbeat.
 * Uncommitted edits are not seen; only commits count.
 * @param repoDir - The checkout the agent loaded its code from.
 * @returns A watch whose `check` reports the loaded commit and whether a restart is needed.
 */
export async function watchAgentCode(repoDir: string): Promise<AgentCodeWatch> {
  const loaded = await runGit(repoDir, ["rev-parse", "HEAD"]);
  const short = loaded
    ? await runGit(repoDir, ["rev-parse", "--short", loaded])
    : undefined;
  // A git read that fails for a moment keeps the last answer rather than flipping it.
  let restartNeeded = false;
  return {
    async check() {
      if (!loaded) return { restartNeeded: false };
      const head = await runGit(repoDir, ["rev-parse", "HEAD"]);
      const needed =
        head === undefined
          ? undefined
          : head !== loaded && (await changesAgentCode(repoDir, loaded, head));
      if (needed !== undefined) restartNeeded = needed;
      return {
        ...(short ? { agentCommit: short } : {}),
        restartNeeded,
      };
    },
  };
}
