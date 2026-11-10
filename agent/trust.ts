import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export type TrustMap = Record<string, boolean | undefined>;

/** The answer recorded for the nearest folder at or above `start`, up to the repo root. */
function walk(start: string, projects: TrustMap): boolean | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (projects[dir] !== undefined) return projects[dir];
    // A repo root ends the walk: trust above it does not reach in. A worktree's `.git` is a file, so it counts too.
    if (existsSync(join(dir, ".git"))) return undefined;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Whether Claude Code has been told to trust a folder.
 * @param folder - The folder a window will start in.
 * @param projects - Each known project path with its trust answer.
 * @returns The answer, or undefined when none applies.
 */
export function resolveTrust(
  folder: string,
  projects: TrustMap,
): boolean | undefined {
  let real = folder;
  try {
    real = realpathSync(folder);
  } catch {
    // A folder that is gone keeps its typed path.
  }
  // Claude Code records real paths; the typed path covers a record made through a link.
  return (
    walk(real, projects) ??
    (real === folder ? undefined : walk(folder, projects))
  );
}

const claudeJsonTrustSchema = z.object({
  projects: z.record(
    z.string(),
    // An entry or answer of an unexpected shape reads as no answer, so one odd project never hides the rest.
    z
      .object({
        hasTrustDialogAccepted: z.boolean().optional().catch(undefined),
      })
      .catch({}),
  ),
});

/**
 * Reads each project's trust answer from `~/.claude.json`, read-only.
 * @param home - The user's home folder.
 * @returns The answers, or undefined when the file is missing, unparsable or has no projects.
 */
export function readTrustMap(home: string): TrustMap | undefined {
  try {
    const parsed = claudeJsonTrustSchema.parse(
      JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")),
    );
    return Object.fromEntries(
      Object.entries(parsed.projects).map(([path, project]) => [
        path,
        project.hasTrustDialogAccepted,
      ]),
    );
  } catch {
    // Claude Code rewrites the file in place, so a read can catch it half-written; the next beat reads it again.
    return undefined;
  }
}
