import { execFile } from "node:child_process";

const GIT_TIMEOUT_MS = 3000;

/**
 * Reads the short commit of the checkout the agent loaded its code from, once at start.
 * Uncommitted edits are not seen; only commits count.
 * @param repoDir - The checkout the agent loaded its code from.
 * @returns The short commit, or undefined when the checkout is not a readable git repo or git timed out.
 */
export function readAgentCommit(repoDir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      // No index lock, so the read never blocks the owner's own git commands.
      ["--no-optional-locks", "rev-parse", "--short", "HEAD"],
      { cwd: repoDir, timeout: GIT_TIMEOUT_MS },
      (error, stdout) =>
        resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}
