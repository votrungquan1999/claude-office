import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepoResolver,
  type GitAnswer,
  type GitRunner,
} from "./repo-resolver";

/** Runs git in a folder with a fixed identity. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "ignore" },
  );
}

describe("the repo resolver", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  /** A real temp folder; git reports real paths, so the macOS /var link is resolved up front. */
  function makeRoot(): string {
    const root = mkdtempSync(
      join(realpathSync(tmpdir()), "claude-office-resolver-"),
    );
    roots.push(root);
    return root;
  }

  it("resolves a worktree to its main repo and a plain folder to nothing", async () => {
    // Given a repo with a worktree and a folder outside any repo
    const root = makeRoot();
    const main = join(root, "app");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const worktree = join(root, "app-pr-1");
    git(main, "worktree", "add", "-q", worktree);
    const plain = join(root, "plain");
    mkdirSync(plain);
    const resolver = createRepoResolver();

    // When each is resolved
    const fromWorktree = await resolver.resolve(worktree);
    const fromMain = await resolver.resolve(join(main));
    const fromPlain = await resolver.resolve(plain);

    // Then the worktree gives the main repo, and the plain folder gives nothing
    expect(fromWorktree).toEqual({ path: main, name: "app" });
    expect(fromMain).toEqual({ path: main, name: "app" });
    expect(fromPlain).toBeUndefined();
  });

  it("finds a repo created in a folder that was not one a moment ago, once the miss has expired", async () => {
    // Given a folder that is not a repo yet, and a resolver that remembers a miss for 30 seconds
    const root = makeRoot();
    let clock = 0;
    const resolver = createRepoResolver({ now: () => clock });
    expect(await resolver.resolve(root)).toBeUndefined();

    // When it becomes a repo, first within the miss window and then after it
    git(root, "init", "-q");
    const within = await resolver.resolve(root);
    clock = 31_000;
    const after = await resolver.resolve(root);

    // Then only the later lookup sees the repo
    expect(within).toBeUndefined();
    expect(after?.path).toBe(root);
  });
});

describe("the repo resolver's lookups", () => {
  /**
   * A repo answer for a folder.
   * @param dir - The folder, which is its own top level.
   * @returns What git would say.
   */
  const repoAt = (dir: string): GitAnswer => ({
    status: "found",
    toplevel: dir,
    common: `${dir}/.git`,
  });

  it("shares one git run between two lookups of the same folder in flight", async () => {
    // Given a git runner that answers once released
    const calls: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runGit: GitRunner = async (dir) => {
      calls.push(dir);
      await gate;
      return repoAt(dir);
    };
    const resolver = createRepoResolver({ runGit });

    // When the same folder is looked up twice before git answers
    const first = resolver.resolve("/w/app");
    const second = resolver.resolve("/w/app");
    release();

    // Then git ran once and both got the repo
    expect(await first).toEqual({ path: "/w/app", name: "app" });
    expect(await second).toEqual({ path: "/w/app", name: "app" });
    expect(calls).toEqual(["/w/app"]);
  });

  it("never runs more git calls at once than the concurrency limit", async () => {
    // Given a runner that tracks how many calls overlap
    let active = 0;
    let peak = 0;
    const runGit: GitRunner = async (dir) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return repoAt(dir);
    };
    const resolver = createRepoResolver({ concurrency: 2, runGit });

    // When six different folders are looked up together
    const repos = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((name) =>
        resolver.resolve(`/w/${name}`),
      ),
    );

    // Then all six resolved and no more than two ran at once
    expect(repos.map((repo) => repo?.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(peak).toBe(2);
  });

  it("drops the folder used longest ago when the cache is full", async () => {
    // Given a cache of two folders, a and b, with a used after b
    const calls: string[] = [];
    const runGit: GitRunner = async (dir) => {
      calls.push(dir);
      return repoAt(dir);
    };
    const resolver = createRepoResolver({ cacheSize: 2, runGit });
    await resolver.resolve("/w/a");
    await resolver.resolve("/w/b");
    await resolver.resolve("/w/a");

    // When a third folder arrives, then a and b are asked again
    await resolver.resolve("/w/c");
    await resolver.resolve("/w/a");
    await resolver.resolve("/w/b");

    // Then only b needed git again
    expect(calls).toEqual(["/w/a", "/w/b", "/w/c", "/w/b"]);
  });

  it("does not remember a lookup git could not answer, so the next one asks again", async () => {
    // Given git that times out once and then answers
    const answers: GitAnswer[] = [{ status: "failed" }, repoAt("/w/app")];
    const calls: string[] = [];
    const runGit: GitRunner = async (dir) => {
      calls.push(dir);
      return answers.shift() ?? { status: "failed" };
    };
    const resolver = createRepoResolver({ runGit });

    // When the folder is looked up twice
    const first = resolver.resolve("/w/app");
    await expect(first).rejects.toThrow();
    const second = await resolver.resolve("/w/app");

    // Then the timeout was reported, not cached, and the retry found the repo
    expect(second).toEqual({ path: "/w/app", name: "app" });
    expect(calls).toHaveLength(2);
  });

  it("remembers that a folder is no repo until the miss expires, and forgets expired misses", async () => {
    // Given git that says a folder is no repo
    let clock = 0;
    const calls: string[] = [];
    const runGit: GitRunner = async (dir) => {
      calls.push(dir);
      return { status: "notRepo" };
    };
    const resolver = createRepoResolver({ now: () => clock, runGit });

    // When the folder is asked twice inside the window and once after it
    await resolver.resolve("/w/plain");
    await resolver.resolve("/w/plain");
    clock = 31_000;
    await resolver.resolve("/w/plain");

    // Then git ran for the first and the expired one only
    expect(calls).toEqual(["/w/plain", "/w/plain"]);
  });
});
