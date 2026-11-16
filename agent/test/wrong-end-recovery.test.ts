import { describe, expect, it } from "vitest";
import { listRegistry } from "../registry";
import { type ProcessProbe, SessionTracker } from "../tracker";
import type { SessionDoc, SessionWriter } from "../writer";
import { makeFakeHome } from "./fake-home";

/** A probe that finds the process alive, or gone, on its own `ps -p` too. */
const probe = (running: boolean): ProcessProbe => ({
  tableStart: () => undefined,
  recheck: () => ({ running }),
});

describe("a hired desk that a check wrongly marked Not running", () => {
  it("is running again at the next check that finds the same process alive", () => {
    // Given a hired employee whose window registered and was seen alive
    const fake = makeFakeHome("m-wrong-end");
    const published: Array<Record<string, unknown>> = [];
    const writer = {
      submit: (doc: Record<string, unknown>) => published.push(doc),
      flush: async () => {},
    } as unknown as SessionWriter;
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-wrong-end",
      machineName: "Wrong-end Mac",
      reorderMs: 1,
      now: () => 1_000_000_000_000,
      writer,
    });
    tracker.trackHired({
      sessionId: "hired",
      folder: "/work/app",
      launchedAt: 1_000_000_000_000,
      message: "Hello",
      trusted: true,
    });
    fake.addSession({
      sessionId: "hired",
      cwd: "/work/app",
      entrypoint: "cli",
      pid: 51_000,
      procStart: "Mon Nov 16 08:00:00 2026",
    });
    const entries = listRegistry(fake.home);
    tracker.reconcile(entries, () => true, probe(true));
    tracker.reconcile(entries, () => true, probe(true));
    const latest = () =>
      published.filter((doc) => doc.sessionId === "hired").at(-1);
    expect(latest()).toMatchObject({ state: "idle", kept: "hired" });
    expect(latest()).not.toHaveProperty("notRunning");

    // When one check misses its process in both the table and its own ps, and the next check finds the same process alive
    tracker.reconcile(entries, () => false, probe(false));
    expect(latest()).toMatchObject({ notRunning: true });
    tracker.reconcile(entries, () => true, probe(true));

    // Then the desk is running again, still hired
    expect(latest()).toMatchObject({ state: "idle", kept: "hired" });
    expect(latest()).not.toHaveProperty("notRunning");
    tracker.stop();
    fake.remove();
  });
});

describe("a plain session resumed in a new process that a check wrongly sent home", () => {
  it("is back at work at the next check that finds the new process alive", async () => {
    // Given a plain session seen alive by a check as pid 100
    const fake = makeFakeHome("m-resumed-end");
    const published: SessionDoc[] = [];
    const writer = {
      submit: (doc: SessionDoc) => published.push(doc),
      flush: async () => {},
    } as unknown as SessionWriter;
    const tracker = new SessionTracker({
      home: fake.home,
      machineId: "m-resumed-end",
      machineName: "Resumed Mac",
      reorderMs: 1,
      now: () => 1_000_000_000_000,
      writer,
    });
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: 100,
      procStart: "Mon Nov 16 08:00:00 2026",
    });
    tracker.ingest({
      hook_event_name: "SessionStart",
      session_id: "plain",
      cwd: "/work/plain",
      source: "startup",
      hookTs: 10,
    });
    await tracker.flush();
    tracker.reconcile(listRegistry(fake.home), () => true, probe(true));

    // When it is resumed in pid 200 without a SessionStart reaching the agent, one check misses pid 200 in both the table and its own ps, and the next check finds pid 200 alive
    fake.removeSession("plain");
    fake.addSession({
      sessionId: "plain",
      cwd: "/work/plain",
      pid: 200,
      procStart: "Mon Nov 16 09:00:00 2026",
    });
    const latest = () =>
      published.filter((doc) => doc.sessionId === "plain").at(-1);
    tracker.reconcile(listRegistry(fake.home), () => false, probe(false));
    expect(latest()).toMatchObject({ state: "wentHome" });
    tracker.reconcile(
      listRegistry(fake.home),
      (process) => process.pid === 200,
      probe(false),
    );

    // Then it is back at work, with no end time
    expect(latest()).toMatchObject({ state: "idle" });
    expect(latest()).not.toHaveProperty("endedAt");
    tracker.stop();
    fake.remove();
  });
});
