import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BSON } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

/** Runs git in a folder with a fixed identity so commits work on any machine. */
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

/** Makes a repo with one commit. */
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
}

/** Every collection of the test database as one searchable text. */
async function databaseDump(): Promise<string> {
  const db = await getDb();
  const parts: string[] = [];
  for (const { name } of await db.listCollections().toArray()) {
    const docs = await db.collection(name).find({}).toArray();
    parts.push(name, BSON.EJSON.stringify(docs), JSON.stringify(docs));
  }
  return parts.join("\n");
}

describe("an employee shows the repos it worked in as tags", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  /** A real folder tree under the real tmp path, since git reports real paths (macOS /var is a link). */
  function makeTree() {
    const root = mkdtempSync(
      join(realpathSync(tmpdir()), "claude-office-tags-"),
    );
    roots.push(root);
    // The start folder sits inside an outer repo, like ubet-devenv/workspace
    const outer = join(root, "ubet-devenv");
    initRepo(outer);
    const workspace = join(outer, "workspace");
    mkdirSync(join(workspace, "docs"), { recursive: true });
    const backend = join(workspace, "upredict-backend");
    initRepo(backend);
    const worktree = join(workspace, "upredict-backend-pr-713");
    git(backend, "worktree", "add", "-q", worktree);
    return { root, outer, workspace, backend, worktree };
  }

  it("tags the main repo of a worktree and never the repo around the start folder", async () => {
    // Given a session started in workspace/, inside the outer repo ubet-devenv
    const tree = makeTree();
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({ hook_event_name: "UserPromptSubmit", prompt: "go" });

    // When it edits a file in a worktree of upredict-backend, and runs a command in workspace/docs
    writeFileSync(join(tree.worktree, "a.ts"), "");
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(tree.worktree, "a.ts") },
      duration_ms: 5,
    });
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "t2",
      cwd: join(tree.workspace, "docs"),
      tool_input: { description: "List docs" },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the session carries one tag, the main repo's name with an opaque key, and no folder path
    const [session] = await officeSessions();
    expect(session?.tags).toEqual([
      {
        name: "upredict-backend",
        key: expect.stringMatching(/^[0-9a-f]{12}$/),
        parent: "workspace",
      },
    ]);
    expect(JSON.stringify(session?.tags)).not.toContain(tree.root);
  });

  it("never tags a repo that wraps the start folder's own separate repo", async () => {
    // Given a session started in a separate repo that sits inside a bigger repo
    const tree = makeTree();
    const inner = join(tree.outer, "inner-repo");
    initRepo(inner);
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: inner });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: inner, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });

    // When it edits a file in the outer repo
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(tree.outer, "a.ts") },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the step is recorded but the outer repo is not a tag
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((step) => step.text)).toEqual([
      "Edit a.ts",
    ]);
    expect(session?.tags).toBeUndefined();
  });

  it("stores a step's folder nowhere in the database, only the repo's name and key", async () => {
    // Given a session that edits a file in a folder with a distinctive name inside a repo
    const tree = makeTree();
    const secret = join(tree.backend, "src", "secret-subdir-7f3a");
    mkdirSync(secret, { recursive: true });
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });

    // When the edit finishes
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_use_id: "t1",
      tool_input: { file_path: join(secret, "x.ts") },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the repo is tagged and the folder text is in no collection
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name)).toEqual(["upredict-backend"]);
    expect(await databaseDump()).not.toContain("secret-subdir-7f3a");
  });

  it("keeps a tag after its worktree folder is deleted", async () => {
    // Given a session that edited a file in a worktree and was tagged
    const tree = makeTree();
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(tree.worktree, "a.ts") },
      duration_ms: 5,
    });
    await agent.flush();
    expect((await officeSessions())[0]?.tags).toHaveLength(1);

    // When the worktree is deleted and the session does more work, in the gone folder and elsewhere
    rmSync(tree.worktree, { recursive: true, force: true });
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t2",
      tool_input: { file_path: join(tree.worktree, "b.ts") },
      duration_ms: 5,
    });
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "t3",
      tool_input: { description: "Run" },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the tag is still there, once
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name)).toEqual(["upredict-backend"]);
  });

  it("tags a repo that only a subagent worked in", async () => {
    // Given a session whose subagent runs in a worktree of upredict-backend
    const tree = makeTree();
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });

    // When the subagent edits a file there
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      agent_id: "sub-1",
      agent_type: "general-purpose",
      cwd: tree.worktree,
      tool_input: { file_path: join(tree.worktree, "a.ts") },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the session carries the tag, and its own folder is still the start folder
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name)).toEqual(["upredict-backend"]);
    expect(session?.cwd).toBe(tree.workspace);
  });

  it("adds no tag for the main checkout when the session started in a worktree of it", async () => {
    // Given a session started in a worktree of upredict-backend
    const tree = makeTree();
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.worktree });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.worktree, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });

    // When it edits a file in the main checkout
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(tree.backend, "a.ts") },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the session has no tag, though it exists and has the step
    const [session] = await officeSessions();
    expect(session?.recentSteps?.map((step) => step.text)).toEqual([
      "Edit a.ts",
    ]);
    expect(session?.tags).toBeUndefined();
  });

  it("keeps the tags of a session already running when the agent starts, from the stored session and the transcript's tool folders", async () => {
    // Given a running session whose stored copy has a tag, and whose transcript shows an edit in a worktree and a notebook edit
    const tree = makeTree();
    const live = await processes.live();
    const db = await getDb();
    await db.collection("sessions").insertOne({
      machineId: "machine-air",
      machineName: "Quan's MacBook Air",
      sessionId: "run-a",
      cwd: tree.workspace,
      state: "idle",
      startedAt: new Date(),
      tags: [
        { name: "old-repo", key: "aaaaaaaaaaaa", parent: "personal" },
        { name: "legacy-repo", key: "bbbbbbbbbbbb" },
      ],
      changedAt: new Date(),
    });
    const toolRecord = (input: object) => ({
      type: "assistant",
      cwd: tree.workspace,
      message: { content: [{ type: "tool_use", name: "Edit", input }] },
    });

    // When the agent starts
    await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        fake.addSession({
          sessionId: "run-a",
          cwd: tree.workspace,
          pid: live.pid,
          procStart: live.procStart,
        });
        fake.addTranscript("run-a", [
          { type: "user", cwd: tree.workspace, message: { content: "go" } },
          toolRecord({
            file_path: join(tree.worktree, "a.ts"),
            command: "SECRET",
          }),
        ]);
      },
    });

    // Then the session shows both the stored tag and the one from the transcript, once each
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name).sort()).toEqual([
      "legacy-repo",
      "old-repo",
      "upredict-backend",
    ]);
    // And a stored parent survives the restart, while a tag stored without one stays valid
    expect(session?.tags).toContainEqual({
      name: "old-repo",
      key: "aaaaaaaaaaaa",
      parent: "personal",
    });
    expect(session?.tags).toContainEqual({
      name: "legacy-repo",
      key: "bbbbbbbbbbbb",
    });
  });

  it("tags a repo whose first touch is a write into a folder that does not exist yet", async () => {
    // Given a session started in workspace/ and a repo that has no docs/new folder yet
    const tree = makeTree();
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });
    const folder = join(tree.backend, "docs", "new");
    const toolInput = { file_path: join(folder, "a.md") };

    // When the write is announced before the folder exists and finishes after it was created
    await send({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_use_id: "t1",
      tool_input: toolInput,
    });
    await agent.flush();
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "a.md"), "");
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_use_id: "t1",
      tool_input: toolInput,
      duration_ms: 5,
    });
    await agent.flush();

    // Then the repo is tagged
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name)).toEqual(["upredict-backend"]);
  });

  it("finds the repo of a transcript's relative tool path from the record's own folder", async () => {
    // Given a running session whose transcript edits a relative path from inside a worktree
    const tree = makeTree();
    const live = await processes.live();

    // When the agent starts
    await setUpMac("machine-air", "Quan's MacBook Air", {
      beforeStart(fake) {
        fake.addSession({
          sessionId: "run-a",
          cwd: tree.workspace,
          pid: live.pid,
          procStart: live.procStart,
        });
        fake.addTranscript("run-a", [
          { type: "user", cwd: tree.workspace, message: { content: "go" } },
          {
            type: "assistant",
            cwd: tree.worktree,
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Edit",
                  input: { file_path: "a.ts" },
                },
              ],
            },
          },
        ]);
      },
    });

    // Then the worktree's main repo is tagged
    const [session] = await officeSessions();
    expect(session?.tags?.map((tag) => tag.name)).toEqual(["upredict-backend"]);
  });

  it("cannot tag a folder that was deleted before it was ever resolved", async () => {
    // Given a session whose only file step is in a worktree folder that is already gone
    const tree = makeTree();
    rmSync(tree.worktree, { recursive: true, force: true });
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: tree.workspace });
    const send = (event: Record<string, unknown>) =>
      runHook(fake.home, { session_id: "s1", cwd: tree.workspace, ...event });
    await send({ hook_event_name: "SessionStart", source: "startup" });

    // When the step is reported
    await send({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "t1",
      tool_input: { file_path: join(tree.worktree, "a.ts") },
      duration_ms: 5,
    });
    await agent.flush();

    // Then the step shows but no tag exists
    const [session] = await officeSessions();
    expect(session?.recentSteps).toHaveLength(1);
    expect(session?.tags).toBeUndefined();
  });
});
