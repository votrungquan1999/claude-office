import { describe, expect, it } from "vitest";
import { offlineMachineIds } from "./offline";

const NOW = "2026-11-08T10:00:00.000Z";

function machine(machineId: string, secondsAgo: number) {
  return {
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
