import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

describe("Claude Code changing its own file formats", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("keeps a session whose registry entry has an unknown status or unexpected field types", async () => {
    // Given a running session whose registry entry carries a status value this agent has never seen and a field of a new type
    const live = await processes.live();

    // When the agent starts
    await setUpMac("machine-fmt", "Format Mac", {
      beforeStart: (fake) => {
        fake.addSession({
          sessionId: "new-format",
          cwd: "/work/new",
          pid: live.pid,
          procStart: live.procStart,
        });
        fake.updateSession("new-format", {
          status: "thinking",
          name: 42,
          statusUpdatedAt: "yesterday",
        } as never);
      },
    });

    // Then the session is still in the office
    const sessions = await officeSessions();
    expect(sessions.map((session) => session.sessionId)).toEqual([
      "new-format",
    ]);
  }, 60_000);

  it("tracks from hooks alone and sends nothing home when the registry folder is missing", async () => {
    // Given a stored session of this Mac and no registry folder at all
    const db = await getDb();
    await db.collection("sessions").insertOne({
      machineId: "machine-noreg",
      machineName: "No Registry Mac",
      sessionId: "stored-1",
      cwd: "/work/stored",
      state: "working",
      startedAt: new Date(Date.now() - 3_600_000),
      changedAt: new Date(),
    });
    const { fake, agent } = await setUpMac("machine-noreg", "No Registry Mac", {
      beforeStart: (home) =>
        rmSync(join(home.home, ".claude", "sessions"), {
          recursive: true,
          force: true,
        }),
    });

    // When a new session announces itself by hook and the agent checks its sessions
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "hooked-1",
      cwd: "/work/hooked",
      source: "startup",
    });
    await agent.reconcile();
    await agent.flush();

    // Then the stored session was not sent home and the hooked one is shown
    expect(
      (await db.collection("sessions").findOne({ sessionId: "stored-1" }))
        ?.state,
    ).toBe("working");
    expect(
      (await db.collection("sessions").findOne({ sessionId: "hooked-1" }))?.cwd,
    ).toBe("/work/hooked");
  }, 60_000);

  it("still shows a running session whose transcript cannot be read", async () => {
    // Given a running session whose transcript path is unreadable as a file
    const live = await processes.live();

    // When the agent starts
    await setUpMac("machine-badtx", "Bad Transcript Mac", {
      beforeStart: (fake) => {
        fake.addSession({
          sessionId: "badtx",
          cwd: "/work/badtx",
          pid: live.pid,
          procStart: live.procStart,
        });
        mkdirSync(join(fake.home, ".claude", "projects", "p", "badtx.jsonl"), {
          recursive: true,
        });
      },
    });

    // Then the session is in the office with the registry's folder
    const sessions = await officeSessions();
    expect(sessions.map((session) => session.cwd)).toEqual(["/work/badtx"]);
  }, 60_000);
});
