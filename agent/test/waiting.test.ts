import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { postHire } from "./hire-order";
import { useLiveProcesses } from "./live-process";
import { type MacHarness, useMacHarness } from "./mac-harness";

const MESSAGE = "Fix the login bug in the signup form";

type Mac = Awaited<ReturnType<MacHarness["setUpMac"]>>;

/** Hires into a folder the Mac knows and lets the agent open the window; returns the new session's id. */
async function hireInto(mac: Mac, folder: string, message = MESSAGE) {
  await (await getDb()).collection("folders").insertOne({
    machineId: "machine-air",
    path: folder,
    companyMode: true,
    firstSeenAt: new Date(),
  });
  const { body } = await postHire("machine-air", folder, message);
  await mac.agent.pollCommands();
  await mac.agent.flush();
  return body?.sessionId ?? "";
}

describe("a hired desk before Claude Code has started", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("waits at the Mac in Needs permission, named from the message, in a folder Claude Code has not trusted, and becomes a normal desk once Claude Code registers", async () => {
    // Given a Mac whose Claude Code refused this folder
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("untrusted");
    mac.fake.trust(folder, false);

    // When the owner hires into it and the window opens
    const sessionId = await hireInto(mac, folder);

    // Then the desk is already there, waiting at the Mac in Needs permission, named from the message
    const [waiting] = await officeSessions();
    expect(waiting).toMatchObject({
      sessionId,
      state: "needsPermission",
      waitingAtMac: true,
      kept: "hired",
      deskName: MESSAGE,
    });
    expect(waiting).not.toHaveProperty("starting");

    // When Claude Code starts in the window
    const running = await processes.live();
    mac.terminal.startSession(sessionId, {
      cwd: folder,
      pid: running.pid,
      procStart: running.procStart,
      bridgeSessionId: "bridge-hired",
    });
    await mac.agent.reconcile();
    await mac.agent.flush();

    // Then it is a normal desk with neither flag
    const [normal] = await officeSessions();
    expect(normal).toMatchObject({ sessionId, state: "idle", kept: "hired" });
    expect(normal).not.toHaveProperty("waitingAtMac");
    expect(normal).not.toHaveProperty("starting");
  });

  it("shows starting in Idle, named from the message, in a folder Claude Code trusts", async () => {
    // Given a Mac whose Claude Code trusts the repo that holds the folder
    const mac = await setUpMac("machine-air", "Air");
    const repo = mac.fake.makeGitRoot("trusted");
    const folder = mac.fake.makeFolder("trusted/pkg");
    mac.fake.trust(repo, true);

    // When the owner hires into the folder and the window opens
    const sessionId = await hireInto(mac, folder);

    // Then the desk is starting in Idle, with no waiting flag
    const [starting] = await officeSessions();
    expect(starting).toMatchObject({
      sessionId,
      state: "idle",
      starting: true,
      kept: "hired",
      deskName: MESSAGE,
    });
    expect(starting).not.toHaveProperty("waitingAtMac");
  });

  it("waits rather than starts when ~/.claude.json is missing, since the Mac cannot tell whether the folder is trusted", async () => {
    // Given a Mac with no ~/.claude.json
    const mac = await setUpMac("machine-air", "Air");
    const folder = mac.fake.makeFolder("anywhere");
    mac.fake.removeClaudeJson();

    // When the owner hires into the folder and the window opens
    const sessionId = await hireInto(mac, folder);

    // Then the desk waits at the Mac
    const [waiting] = await officeSessions();
    expect(waiting).toMatchObject({
      sessionId,
      state: "needsPermission",
      waitingAtMac: true,
    });
  });

  it("keeps a waiting desk and a starting desk when the agent restarts before Claude Code registers", async () => {
    // Given one waiting and one starting hire on a Mac that then restarts
    const mac = await setUpMac("machine-air", "Air");
    const refused = mac.fake.makeFolder("refused");
    mac.fake.trust(refused, false);
    const repo = mac.fake.makeGitRoot("ok");
    mac.fake.trust(repo, true);
    const waitingId = await hireInto(mac, refused, "Refused folder task");
    const startingId = await hireInto(mac, repo, "Trusted folder task");
    await mac.agent.stop();
    await setUpMac("machine-air", "Air", { fake: mac.fake });

    // When the restarted agent has finished starting
    const desks = await officeSessions();

    // Then both desks are still there with their flags, names and kept mark, and neither is marked not running
    const byId = Object.fromEntries(desks.map((d) => [d.sessionId, d]));
    expect(byId[waitingId]).toMatchObject({
      state: "needsPermission",
      waitingAtMac: true,
      kept: "hired",
      deskName: "Refused folder task",
    });
    expect(byId[startingId]).toMatchObject({
      state: "idle",
      starting: true,
      kept: "hired",
      deskName: "Trusted folder task",
    });
    expect(byId[waitingId]).not.toHaveProperty("notRunning");
    expect(byId[startingId]).not.toHaveProperty("notRunning");
  });
});
