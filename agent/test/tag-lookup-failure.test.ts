import { describe, expect, it } from "vitest";
import { createRepoResolver, type GitAnswer } from "../repo-resolver";
import { SessionTracker } from "../tracker";
import type { SessionDoc, SessionWriter } from "../writer";
import { makeFakeHome } from "./fake-home";

describe("repo tags when git cannot answer", () => {
  it("does not tag the main checkout when the lookup of the start folder fails once", async () => {
    // Given a session started in a worktree of /w/backend, whose first lookup times out
    const fake = makeFakeHome("m-tags");
    const submitted: SessionDoc[] = [];
    const writer = {
      submit: (doc: SessionDoc) => {
        submitted.push(doc);
      },
      flush: async () => {},
    } as unknown as SessionWriter;
    const answers = new Map<string, GitAnswer[]>([
      [
        "/w/backend-pr-1",
        [
          { status: "failed" },
          {
            status: "found",
            toplevel: "/w/backend-pr-1",
            common: "/w/backend/.git",
          },
        ],
      ],
      [
        "/w/backend",
        [
          {
            status: "found",
            toplevel: "/w/backend",
            common: "/w/backend/.git",
          },
        ],
      ],
    ]);
    const repos = createRepoResolver({
      // The last answer repeats once the list runs out.
      runGit: async (dir) => {
        const list = answers.get(dir) ?? [{ status: "notRepo" }];
        return (list.length > 1 ? list.shift() : list[0]) as GitAnswer;
      },
    });
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-tags",
      machineName: "Tags Mac",
      reorderMs: 1,
      now: () => 1_000_000_000_000,
      writer,
      repos,
    });
    fake.addSession({ sessionId: "s1", cwd: "/w/backend-pr-1" });
    const edit = (n: number, dir: string) =>
      tracker.ingest({
        session_id: "s1",
        cwd: "/w/backend-pr-1",
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_use_id: `t${n}`,
        tool_input: { file_dir: dir },
        hookTs: 1_000_000_000_000 + n,
      });

    // When it edits in the main checkout, then edits there again
    edit(1, "/w/backend");
    await tracker.flush();
    edit(2, "/w/backend");
    await tracker.flush();
    tracker.reconcile([], () => true);
    await tracker.flush();

    // Then the main checkout is never tagged
    expect(submitted.length).toBeGreaterThan(0);
    expect(submitted.flatMap((doc) => doc.tags ?? [])).toEqual([]);
    tracker.stop();
    fake.remove();
  });
});
