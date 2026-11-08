import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";

/** The repo a folder belongs to. */
export interface ResolvedRepo {
  /** The main checkout's folder; a worktree resolves to the repo it was added from. */
  path: string;
  /** The repo's folder name. */
  name: string;
}

/** Git could not answer for a folder, so nothing is known about it yet. */
export class RepoLookupError extends Error {
  /**
   * @param dir - The folder that was being looked up.
   */
  constructor(dir: string) {
    super(`git could not answer for ${dir}`);
    this.name = "RepoLookupError";
  }
}

export interface RepoResolver {
  /**
   * Finds the main repo around a folder.
   * @param dir - Any folder, which may no longer exist.
   * @returns The repo, or undefined when the folder is not in one or is gone.
   * @throws RepoLookupError when git timed out or could not start; nothing is cached, so a later call asks again.
   */
  resolve(dir: string): Promise<ResolvedRepo | undefined>;
}

/** What git said about a folder. */
export type GitAnswer =
  | { status: "found"; toplevel: string; common: string }
  /** Git ran and the folder is no repo or is gone. */
  | { status: "notRepo" }
  /** Git could not answer: it timed out or could not start. */
  | { status: "failed" };

/** Asks git about one folder. */
export type GitRunner = (dir: string) => Promise<GitAnswer>;

export interface RepoResolverOptions {
  /** Most git calls running at once. */
  concurrency?: number;
  /** Most folders remembered. */
  cacheSize?: number;
  /** How long a "not a repo" answer is remembered, so a later `git init` still tags. */
  failureTtlMs?: number;
  now?: () => number;
  /** How git is asked; defaults to the git binary. */
  runGit?: GitRunner;
}

const GIT_TIMEOUT_MS = 3000;
/** git's exit code for "not a git repository" and for a folder that cannot be entered. */
const GIT_NOT_A_REPO = 128;

/**
 * The folder itself, or its nearest ancestor that exists, so a write into a folder not yet created still finds its repo.
 * @param dir - Any folder.
 * @returns An existing folder, or the input when none of its ancestors exists.
 */
function nearestExisting(dir: string): string {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
  return current;
}

/**
 * Asks git for a folder's top level and common dir, off the event loop.
 * @param dir - The folder; a missing one is answered for its nearest existing ancestor.
 * @returns The two absolute paths, "notRepo" when git says so, or "failed" on a timeout or spawn error.
 */
const readGit: GitRunner = (dir) =>
  new Promise((resolve) => {
    execFile(
      "git",
      [
        "-C",
        nearestExisting(dir),
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
      ],
      // No index lock, so a lookup never blocks the owner's own git commands.
      {
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        timeout: GIT_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          return resolve({
            status: error.code === GIT_NOT_A_REPO ? "notRepo" : "failed",
          });
        }
        const [toplevel, common] = stdout.trim().split("\n");
        resolve(
          toplevel && common
            ? { status: "found", toplevel, common }
            : { status: "notRepo" },
        );
      },
    );
  });

/**
 * Builds a resolver that caches by exact folder and never blocks a hook.
 * @param options - Limits and clock.
 * @returns The resolver.
 */
export function createRepoResolver({
  concurrency = 4,
  cacheSize = 2000,
  failureTtlMs = 30_000,
  now = Date.now,
  runGit = readGit,
}: RepoResolverOptions = {}): RepoResolver {
  // Exact folders only: nested repos make prefix matching wrong.
  const found = new Map<string, ResolvedRepo>();
  const missed = new Map<string, number>();
  const inFlight = new Map<string, Promise<ResolvedRepo | undefined>>();
  const waiting: Array<() => void> = [];
  let running = 0;

  /**
   * Stores an answer as the newest entry and drops the oldest ones beyond the cache size.
   * @param cache - The map to store in; its insertion order is the age order.
   * @param dir - The folder.
   * @param value - The answer.
   */
  function remember<T>(cache: Map<string, T>, dir: string, value: T): void {
    cache.delete(dir);
    cache.set(dir, value);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  /** Waits for one of the git slots. */
  async function acquire(): Promise<void> {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running++;
  }

  /** Frees a git slot for the next waiter. */
  function release(): void {
    running--;
    waiting.shift()?.();
  }

  /** Looks the folder up and remembers the answer. */
  async function lookUp(dir: string): Promise<ResolvedRepo | undefined> {
    await acquire();
    let answer: GitAnswer;
    try {
      answer = await runGit(dir);
    } finally {
      release();
    }
    if (answer.status === "failed") throw new RepoLookupError(dir);
    if (answer.status === "notRepo") {
      remember(missed, dir, now());
      return undefined;
    }
    const { toplevel, common } = answer;
    // A worktree's common dir is the main repo's .git; a submodule or bare repo has no such parent, so its own top level counts.
    const path = basename(common) === ".git" ? dirname(common) : toplevel;
    const repo = { path, name: basename(path) };
    remember(found, dir, repo);
    return repo;
  }

  return {
    async resolve(dir) {
      const cached = found.get(dir);
      if (cached) {
        // A hit becomes the newest entry, so the least recently used one leaves first.
        remember(found, dir, cached);
        return cached;
      }
      const missedAt = missed.get(dir);
      if (missedAt !== undefined) {
        if (now() - missedAt < failureTtlMs) return undefined;
        missed.delete(dir);
      }
      let pending = inFlight.get(dir);
      if (!pending) {
        pending = lookUp(dir).finally(() => inFlight.delete(dir));
        inFlight.set(dir, pending);
      }
      return pending;
    },
  };
}
