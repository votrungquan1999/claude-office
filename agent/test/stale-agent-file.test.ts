import { describe, expect, it } from "vitest";
import { readAgentFile, writeAgentFile } from "../config";
import { readProcessStart } from "../process-start";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";

describe("an agent.json left by an earlier agent", () => {
  const { setUpMac } = useMacHarness();
  const processes = useLiveProcesses();

  it("blocks a second agent only while the process that wrote it is still running", async () => {
    // Given another process running now that an earlier agent's file points at, with its real start time
    const running = await processes.live();
    const reused = await processes.live();

    // When an agent starts while the file names a live process with the matching start time
    const blocked = setUpMac("machine-dup", "Dup Mac", {
      beforeStart: (fake) =>
        writeAgentFile(fake.home, {
          pid: running.pid,
          port: 1,
          token: "t",
          procStart: readProcessStart(running.pid),
        }),
    });

    // Then it refuses, as another agent is running
    await expect(blocked).rejects.toThrow(/already running/);

    // When the file names a live pid whose start time differs (the pid was reused)
    const { fake } = await setUpMac("machine-reused", "Reused Mac", {
      beforeStart: (home) =>
        writeAgentFile(home.home, {
          pid: reused.pid,
          port: 1,
          token: "t",
          procStart: "Mon Jan  1 00:00:00 2001",
        }),
    });

    // Then the agent starts and publishes its own address with its own start time
    const address = readAgentFile(fake.home);
    expect(address?.pid).toBe(process.pid);
    expect(address?.procStart).toBe(readProcessStart(process.pid));
  }, 60_000);
});
