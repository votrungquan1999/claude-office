import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as restartAgent } from "@/app/api/office/machines/restart/route";
import { getDb } from "@/db/mongo";
import { sessionHeadersFor } from "@/test/owner-session";
import type { TerminalOpener } from "../terminal-launch";
import { postHire } from "./hire-order";
import { type MacHarness, useMacHarness } from "./mac-harness";
import { pause } from "./run-hook";

const OWNER = "owner@example.com";
const MACHINE_ID = "machine-air";

/** The owner presses "Restart agent" for a Mac, as the browser sends it. */
async function postRestart(machineId: string): Promise<Response> {
  const headers = new Headers((await sessionHeadersFor(OWNER)) ?? undefined);
  headers.set("content-type", "application/json");
  return restartAgent(
    new NextRequest("http://localhost:4710/api/office/machines/restart", {
      method: "POST",
      headers,
      body: JSON.stringify({ machineId }),
    }),
  );
}

/** A Terminal opener that holds every window until the test lets it go, saying when one is waiting. */
function heldOpener(open: () => TerminalOpener) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const opener: TerminalOpener = async (script) => {
    opened();
    await released;
    await open()(script);
  };
  return { opener, waiting, release };
}

/** A promise that resolves when the agent exits for a restart, and the exit callback that resolves it. */
function exitRecorder() {
  let count = 0;
  let resolve: () => void = () => {};
  const exited = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    exited,
    count: () => count,
    onRestart: () => {
      count++;
      resolve();
    },
  };
}

/** Records a folder of the Mac so a hire may go into it. */
async function knownFolder(
  mac: Awaited<ReturnType<MacHarness["setUpMac"]>>,
  name: string,
): Promise<string> {
  const folder = mac.fake.makeFolder(name);
  await (await getDb()).collection("folders").insertOne({
    machineId: MACHINE_ID,
    path: folder,
    companyMode: true,
    firstSeenAt: new Date(),
  });
  return folder;
}

/** The stored status of one order. */
async function statusOf(orderId: string | undefined): Promise<unknown> {
  const row = await (await getDb())
    .collection("commands")
    .findOne({ _id: orderId as never });
  return row?.status;
}

describe("restarting a Mac's agent from Settings", () => {
  const { setUpMac } = useMacHarness();

  it("lets a running order finish, exits before claiming the next one, and the new agent turns the signal off and runs the waiting order", async () => {
    // Given a launchd-run agent busy opening a hire, with a second hire waiting behind it
    let terminalOpen: TerminalOpener = async () => {};
    const held = heldOpener(() => terminalOpen);
    const exit = exitRecorder();
    const mac = await setUpMac(MACHINE_ID, "Air", {
      runByLaunchd: true,
      onRestart: exit.onRestart,
      terminalOpener: held.opener,
    });
    terminalOpen = mac.terminal.open;
    const first = await postHire(
      MACHINE_ID,
      await knownFolder(mac, "app"),
      "First",
    );
    const second = await postHire(
      MACHINE_ID,
      await knownFolder(mac, "api"),
      "Second",
    );
    const polling = mac.agent.pollCommands();
    await held.waiting;

    // When the owner presses Restart agent while the first hire is still opening
    const response = await postRestart(MACHINE_ID);
    expect(response.status).toBe(200);
    held.release();
    await polling;
    // The exit follows the drain; bounded so a missing exit fails on the outcome, not a timeout.
    await Promise.race([exit.exited, pause(5000)]);

    // Then the first hire finished, the second was never claimed, and the agent exited once
    expect(await statusOf(first.body?.orderId)).toBe("done");
    expect(await statusOf(second.body?.orderId)).toBe("pending");
    expect(exit.count()).toBe(1);

    // When launchd starts the new agent
    const restarted = await setUpMac(MACHINE_ID, "Air", {
      fake: mac.fake,
      runByLaunchd: true,
      onRestart: exit.onRestart,
    });
    const machines = (await getDb()).collection("machines");

    // Then the signal is off, and the new agent runs the waiting hire without exiting again
    expect(
      (await machines.findOne({ machineId: MACHINE_ID }))?.restartRequested,
    ).toBe(false);
    await restarted.agent.pollCommands();
    expect(await statusOf(second.body?.orderId)).toBe("done");
    expect(exit.count()).toBe(1);
  }, 60_000);

  it("exits anyway when a restart's drain never finishes, and only once", async () => {
    // Given a launchd-run agent whose last hire left a window lookup that will not finish for a long time
    const exit = exitRecorder();
    const mac = await setUpMac(MACHINE_ID, "Air", {
      runByLaunchd: true,
      onRestart: exit.onRestart,
      restartDeadlineMs: 300,
      // The opener writes no terminal device, so the lookup waits out this whole window.
      terminalOpener: async () => {},
      windowRecordMs: 2000,
    });
    const hire = await postHire(
      MACHINE_ID,
      await knownFolder(mac, "app"),
      "Hello",
    );
    void mac.agent.pollCommands();
    for (let tries = 0; tries < 100; tries++) {
      if ((await statusOf(hire.body?.orderId)) === "done") break;
      await pause(50);
    }
    expect(await statusOf(hire.body?.orderId)).toBe("done");

    // When the owner presses Restart agent and the agent picks the signal up
    expect((await postRestart(MACHINE_ID)).status).toBe(200);
    void mac.agent.pollCommands();
    await Promise.race([exit.exited, pause(1500)]);

    // Then the agent exited without waiting for the lookup, and not again once the lookup ended
    expect(exit.count()).toBe(1);
    await pause(2500);
    expect(exit.count()).toBe(1);
  }, 60_000);

  it("never exits an agent started by hand: it says so to the office and keeps taking orders while the signal is on", async () => {
    // Given an agent started by hand in a Terminal, and a restart signal on its Mac
    const exit = exitRecorder();
    const mac = await setUpMac(MACHINE_ID, "Air", {
      runByLaunchd: false,
      onRestart: exit.onRestart,
    });
    const machines = (await getDb()).collection("machines");
    await machines.updateOne(
      { machineId: MACHINE_ID },
      { $set: { restartRequested: true } },
    );

    // When the owner hires on that Mac
    const hire = await postHire(
      MACHINE_ID,
      await knownFolder(mac, "app"),
      "Hello",
    );
    await mac.agent.pollCommands();
    await pause(200);

    // Then the hire runs, the agent never exits, and its record says it was started by hand
    expect(await statusOf(hire.body?.orderId)).toBe("done");
    expect(exit.count()).toBe(0);
    expect(
      (await machines.findOne({ machineId: MACHINE_ID }))?.startedByHand,
    ).toBe(true);
  }, 60_000);
});
