import { describe, expect, it } from "vitest";
import { macBlock, offlineMachineIds } from "./offline";

const NOW = "2026-11-08T10:00:00.000Z";

function machine(machineId: string, secondsAgo: number, agentVersion?: string) {
  return {
    ...(agentVersion ? { agentVersion } : {}),
    machineId,
    machineName: machineId,
    lastSeenAt: new Date(Date.parse(NOW) - secondsAgo * 1000).toISOString(),
  };
}

describe("which Macs are offline", () => {
  it("counts a Mac offline once its last heartbeat is more than 3 minutes older than the server's time", () => {
    // Given Macs last seen 10 s, 179 s, 181 s and an hour before the server's time
    const machines = [
      machine("fresh", 10),
      machine("edge-in", 179),
      machine("edge-out", 181),
      machine("gone", 3600),
    ];

    // When the offline ones are worked out
    const offline = offlineMachineIds(machines, NOW);

    // Then only the two past the window are offline
    expect([...offline].sort()).toEqual(["edge-out", "gone"]);
  });
});

describe("whether a Mac can take orders", () => {
  it("blocks a Mac with no record as offline, and lists such a Mac in the offline set", () => {
    // Given one Mac with a fresh record
    const machines = [machine("fresh", 10, "0.3.0")];

    // When a session and a folder name a Mac that has no record
    const offline = offlineMachineIds(machines, NOW, ["fresh", "retired"]);

    // Then the missing Mac counts as offline and the fresh one does not
    expect([...offline]).toEqual(["retired"]);
    expect(macBlock(undefined, NOW)).toBe("offline");
    expect(macBlock(machines[0], NOW)).toBeUndefined();
  });
});

describe("whether a Mac's agent is new enough", () => {
  it("blocks an agent that reports no version, an older one or junk, and lets 0.3.0 and newer through", () => {
    // Given fresh Macs reporting different versions
    const block = (version?: string) => macBlock(machine("m", 5, version), NOW);

    // Then only 0.3.0 and newer pass, compared by number and not by text
    expect(block(undefined)).toBe("outdated");
    expect(block("0.2.0")).toBe("outdated");
    expect(block("junk")).toBe("outdated");
    expect(block("0.3.0")).toBeUndefined();
    expect(block("0.10.0")).toBeUndefined();
    expect(block("1.0.0")).toBeUndefined();

    // And an offline Mac reads offline whatever its version
    expect(macBlock(machine("m", 600, "0.3.0"), NOW)).toBe("offline");
  });
});
