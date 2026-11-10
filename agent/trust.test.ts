import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTrustMap, resolveTrust } from "./trust";

describe("which folders Claude Code trusts", () => {
  let base: string;
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "claude-office-trust-")));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  /** Creates a folder under the temp base; `git` makes it a repo root. */
  function folder(name: string, git?: "dir" | "file"): string {
    const path = join(base, name);
    mkdirSync(path, { recursive: true });
    if (git === "dir") mkdirSync(join(path, ".git"));
    return path;
  }

  it("reads the answer recorded for the folder itself", () => {
    // Given a trusted folder and an untrusted one
    const trusted = folder("trusted");
    const refused = folder("refused");

    // When trust is looked up
    // Then each folder reads its own answer
    expect(resolveTrust(trusted, { [trusted]: true })).toBe(true);
    expect(resolveTrust(refused, { [refused]: false })).toBe(false);
  });

  it("falls back to a trusted parent, and the nearest recorded answer wins", () => {
    // Given a trusted parent, a child with no entry, and a child explicitly refused under it
    const parent = folder("parent");
    const child = folder("parent/child");
    const refused = folder("parent/refused");
    const projects = { [parent]: true, [refused]: false };

    // When trust is looked up
    // Then the child inherits the parent's answer while the refused one stays untrusted
    expect(resolveTrust(child, projects)).toBe(true);
    expect(resolveTrust(refused, projects)).toBe(false);
  });

  it("does not let trust above a nested git repo reach into it, but a trusted repo root covers its sub-folders", () => {
    // Given trust only above a nested repo, and a trusted repo with a sub-folder
    const outer = folder("outer");
    const nested = folder("outer/nested", "dir");
    const inside = folder("outer/nested/src");
    const repo = folder("repo", "dir");
    const repoSub = folder("repo/pkg/deep");

    // When trust is looked up
    // Then the nested repo and its sub-folder are unknown, and the trusted repo's sub-folder is trusted
    expect(resolveTrust(nested, { [outer]: true })).toBeUndefined();
    expect(resolveTrust(inside, { [outer]: true })).toBeUndefined();
    expect(resolveTrust(repoSub, { [repo]: true })).toBe(true);
  });

  it("walks up to the filesystem root when no repo is above, and treats a worktree as its own root", () => {
    // Given a non-git folder under a trusted one, and a worktree (a .git file) under a trusted main repo
    const parent = folder("notes");
    const plain = folder("notes/chairs");
    const main = folder("main", "dir");
    const worktree = folder("main/wt", "file");
    writeFileSync(join(worktree, ".git"), "gitdir: ../.git/worktrees/wt");

    // When trust is looked up
    // Then the plain folder inherits and the worktree stays unknown
    expect(resolveTrust(plain, { [parent]: true })).toBe(true);
    expect(resolveTrust(worktree, { [main]: true })).toBeUndefined();
  });

  it("matches the folder's real path first and its path as typed second", () => {
    // Given a symlinked path to a folder that is recorded under its real path, and another recorded under the typed link
    const real = folder("real-target");
    const link = join(base, "link-to-real");
    symlinkSync(real, link);
    const other = folder("other-target");
    const otherLink = join(base, "link-to-other");
    symlinkSync(other, otherLink);

    // When trust is looked up through each link
    // Then the real-path record answers, and so does the typed-path record
    expect(resolveTrust(link, { [real]: true })).toBe(true);
    expect(resolveTrust(otherLink, { [otherLink]: true })).toBe(true);
  });
});

describe("reading the trust answers from ~/.claude.json", () => {
  let home: string;
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "claude-office-trust-home-"));
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("returns each project's answer, ignores a malformed one, and returns nothing for a missing, half-written or project-less file", () => {
    const file = join(home, ".claude.json");

    // Given no file
    // Then there is nothing to read
    expect(readTrustMap(home)).toBeUndefined();

    // Given a half-written file, then one with no projects key
    writeFileSync(file, '{"projects": {"/a": {"hasTrust');
    expect(readTrustMap(home)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ machineID: "m" }));
    expect(readTrustMap(home)).toBeUndefined();

    // Given projects with a trusted, a refused, a malformed and an unrelated entry
    writeFileSync(
      file,
      JSON.stringify({
        projects: {
          "/a": { hasTrustDialogAccepted: true },
          "/b": { hasTrustDialogAccepted: false },
          "/c": { hasTrustDialogAccepted: "yes" },
          "/d": { allowedTools: [] },
        },
      }),
    );

    // Then only the booleans are answers
    expect(readTrustMap(home)).toEqual({ "/a": true, "/b": false });
  });

  it("reads a project entry that is not an object as no answer, keeping the other projects' answers", () => {
    // Given projects where one entry is a string and another is null
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        projects: {
          "/a": { hasTrustDialogAccepted: true },
          "/odd": "oops",
          "/null": null,
        },
      }),
    );

    // Then the odd entries answer nothing and /a keeps its answer
    expect(readTrustMap(home)).toEqual({ "/a": true });
  });
});
