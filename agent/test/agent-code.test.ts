import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";
import { pause } from "./run-hook";

const repos: string[] = [];

/** Runs git in a test checkout, ignoring the owner's own git settings (signing, hooks). */
function git(repo: string, args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

/** A fresh git checkout with one commit, removed after the test. */
function makeCheckout(): string {
  const repo = mkdtempSync(join(tmpdir(), "office-checkout-"));
  repos.push(repo);
  git(repo, ["init", "-q"]);
  commitFile(repo, "agent/main.ts");
  return repo;
}

/** Commits a change to one file of the checkout and returns the new short commit. */
function commitFile(repo: string, file: string): string {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), `${Math.random()}\n`);
  git(repo, ["add", file]);
  git(repo, ["commit", "-q", "-m", `change ${file}`]);
  return git(repo, ["rev-parse", "--short", "HEAD"]);
}

/** The file of a loose git object in a test checkout. */
function objectFile(repo: string, name: string): string {
  const sha = git(repo, ["rev-parse", name]);
  return join(repo, ".git", "objects", sha.slice(0, 2), sha.slice(2));
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true });
});

describe("a Mac reports which agent code it runs", () => {
  const { setUpMac } = useMacHarness();

  it("reports the loaded commit and start time, says Restart needed only once the checkout holds newer agent code, and a new agent clears it", async () => {
    // Given a Mac whose agent loaded the checkout's current commit
    const repo = makeCheckout();
    const loaded = git(repo, ["rev-parse", "--short", "HEAD"]);
    const first = await setUpMac("machine-air", "Air", { repoDir: repo });
    const machines = (await getDb()).collection("machines");
    const record = () => machines.findOne({ machineId: "machine-air" });

    // Then it reports that commit, when it started, and no restart needed
    const started = await record();
    expect(started?.agentCommit).toBe(loaded);
    expect(started?.agentStartedAt).toBeInstanceOf(Date);
    expect(started?.restartNeeded).toBe(false);

    // When the checkout gains a commit that changes only the docs
    commitFile(repo, "docs/notes.md");
    await first.agent.heartbeat();

    // Then no restart is needed
    expect((await record())?.restartNeeded).toBe(false);

    // When a commit changes code the agent loads
    commitFile(repo, "src/shared/session.ts");
    await first.agent.heartbeat();

    // Then a restart is needed, and the loaded commit and start time stay the same
    const waiting = await record();
    expect(waiting?.restartNeeded).toBe(true);
    expect(waiting?.agentCommit).toBe(loaded);
    expect(waiting?.agentStartedAt).toEqual(started?.agentStartedAt);

    // When a new agent starts on the same checkout
    await first.agent.stop();
    await pause(20);
    const newest = git(repo, ["rev-parse", "--short", "HEAD"]);
    await setUpMac("machine-air", "Air", { repoDir: repo, fake: first.fake });

    // Then it reports the newest commit, a later start time and no restart needed
    const restarted = await record();
    expect(restarted?.agentCommit).toBe(newest);
    expect(restarted?.agentStartedAt.getTime()).toBeGreaterThan(
      started?.agentStartedAt.getTime(),
    );
    expect(restarted?.restartNeeded).toBe(false);
  }, 60_000);

  it("keeps its last answer when git fails for a moment, and says Restart needed when the loaded commit is gone", async () => {
    // Given a Mac whose agent loaded the checkout's commit, and a later commit that changes only the docs
    const repo = makeCheckout();
    const loaded = git(repo, ["rev-parse", "HEAD"]);
    const mac = await setUpMac("machine-air", "Air", { repoDir: repo });
    const machines = (await getDb()).collection("machines");
    const restartNeeded = async () =>
      (await machines.findOne({ machineId: "machine-air" }))?.restartNeeded;
    commitFile(repo, "docs/notes.md");
    await mac.agent.heartbeat();
    expect(await restartNeeded()).toBe(false);

    // When git cannot read the new commit's files for one check
    const docsTree = objectFile(repo, "HEAD^{tree}");
    chmodSync(docsTree, 0o000);
    await mac.agent.heartbeat();
    chmodSync(docsTree, 0o444);

    // Then no restart is needed still
    expect(await restartNeeded()).toBe(false);

    // When the loaded commit is gone from the checkout
    const loadedCommit = objectFile(repo, loaded);
    renameSync(loadedCommit, `${loadedCommit}.away`);
    await mac.agent.heartbeat();
    renameSync(`${loadedCommit}.away`, loadedCommit);

    // Then a restart is needed
    expect(await restartNeeded()).toBe(true);

    // When a commit changes agent code, and then git cannot read the checkout's HEAD for one check
    commitFile(repo, "agent/tracker.ts");
    await mac.agent.heartbeat();
    expect(await restartNeeded()).toBe(true);
    const head = join(repo, ".git", "HEAD");
    chmodSync(head, 0o000);
    await mac.agent.heartbeat();
    chmodSync(head, 0o644);

    // Then a restart is still needed
    expect(await restartNeeded()).toBe(true);
  }, 60_000);
});
