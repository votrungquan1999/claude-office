import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** Commits a change to one file of the checkout. */
function commitFile(repo: string, file: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), `${Math.random()}\n`);
  git(repo, ["add", file]);
  git(repo, ["commit", "-q", "-m", `change ${file}`]);
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true });
});

describe("a Mac reports which agent code it runs", () => {
  const { setUpMac } = useMacHarness();

  it("reports the commit it loaded and its start time, keeps them while the checkout moves on, and a new agent reports the newest", async () => {
    // Given a Mac whose agent loaded the checkout's current commit
    const repo = makeCheckout();
    const loaded = git(repo, ["rev-parse", "--short", "HEAD"]);
    const first = await setUpMac("machine-air", "Air", { repoDir: repo });
    const machines = (await getDb()).collection("machines");
    const record = () => machines.findOne({ machineId: "machine-air" });

    // Then it reports that commit and when it started
    const started = await record();
    expect(started?.agentCommit).toBe(loaded);
    expect(started?.agentStartedAt).toBeInstanceOf(Date);

    // When the checkout gains a commit that changes agent code
    commitFile(repo, "src/shared/session.ts");
    await first.agent.heartbeat();

    // Then the loaded commit and start time stay the same
    const later = await record();
    expect(later?.agentCommit).toBe(loaded);
    expect(later?.agentStartedAt).toEqual(started?.agentStartedAt);

    // When a new agent starts on the same checkout
    await first.agent.stop();
    await pause(20);
    const newest = git(repo, ["rev-parse", "--short", "HEAD"]);
    await setUpMac("machine-air", "Air", { repoDir: repo, fake: first.fake });

    // Then it reports the newest commit and a later start time
    const restarted = await record();
    expect(restarted?.agentCommit).toBe(newest);
    expect(restarted?.agentStartedAt.getTime()).toBeGreaterThan(
      started?.agentStartedAt.getTime(),
    );
  }, 60_000);
});
