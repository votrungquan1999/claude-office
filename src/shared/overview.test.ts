import { describe, expect, it } from "vitest";
import { buildOverview } from "./overview";
import type { SessionDto } from "./session";

const T = "2026-11-09T10:00:00.000Z";
const live = (
  machineId: string,
  sessionId: string,
  cwd: string,
  state: SessionDto["state"],
): SessionDto => ({
  machineId,
  machineName: machineId,
  sessionId,
  cwd,
  startCwd: cwd,
  state,
  startedAt: T,
  changedAt: T,
});

describe("the company overview", () => {
  it("marks a company active from a departure alone, with all counts at zero", () => {
    // Given a company whose only session has gone home
    const gone = { ...live("m1", "f", "/p/y", "wentHome"), endedAt: T };
    const overview = buildOverview({
      folders: [{ machineId: "m1", path: "/p", companyMode: true }],
      sessions: [],
      machines: [{ machineId: "m1", machineName: "Air", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [gone],
    });

    // Then it is active with nothing live
    const [entry] = overview.macs[0].companies;
    expect(entry.active).toBe(true);
    expect(entry.counts).toEqual({
      working: 0,
      needsPermission: 0,
      waitingForYou: 0,
      idle: 0,
    });
  });

  it("counts each company's live sessions by room with Thinking in Working, flags companies that need the owner, and keeps an offline Mac's counts without a badge", () => {
    // Given an online Mac with one company in every live state, plus a departed session, and an offline Mac needing permission
    const sessions = [
      live("m1", "a", "/p/x", "working"),
      live("m1", "b", "/p/x", "thinking"),
      live("m1", "c", "/p/y", "needsPermission"),
      live("m1", "d", "/p/y", "waitingForYou"),
      live("m1", "e", "/p/y", "idle"),
      { ...live("m1", "f", "/p/y", "wentHome"), endedAt: T },
      live("m2", "g", "/q/z", "needsPermission"),
    ];
    const overview = buildOverview({
      folders: [
        { machineId: "m1", path: "/p", companyMode: true },
        { machineId: "m2", path: "/q", companyMode: true },
      ],
      sessions,
      machines: [
        { machineId: "m1", machineName: "Air", lastSeenAt: T },
        { machineId: "m2", machineName: "Mini", lastSeenAt: T },
      ],
      offlineMachineIds: new Set(["m2"]),
      departures: [sessions[5]],
    });

    // Then each Mac lists its companies with four counts
    expect(overview.macs.map((mac) => [mac.machineName, mac.online])).toEqual([
      ["Air", true],
      ["Mini", false],
    ]);
    const [air, mini] = overview.macs;
    expect(
      air.companies.map((c) => [c.company.name, c.counts, c.needsYou]),
    ).toEqual([
      [
        "p",
        { working: 2, needsPermission: 1, waitingForYou: 1, idle: 1 },
        true,
      ],
    ]);
    // And the offline Mac keeps its counts but never shows the badge
    expect(
      mini.companies.map((c) => [c.counts.needsPermission, c.needsYou]),
    ).toEqual([[1, false]]);
  });
});
