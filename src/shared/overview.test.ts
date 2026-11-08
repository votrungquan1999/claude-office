import { describe, expect, it } from "vitest";
import { buildOverview, resolveSelection } from "./overview";
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

  describe("picking the viewed company", () => {
    const base = {
      folders: [
        { machineId: "m1", path: "/zeta", companyMode: true },
        { machineId: "m1", path: "/alpha", companyMode: true },
        { machineId: "m2", path: "/beta", companyMode: true },
      ],
      machines: [
        { machineId: "m1", machineName: "Zed Mac", lastSeenAt: T },
        { machineId: "m2", machineName: "Air", lastSeenAt: T },
      ],
      sessions: [],
      departures: [],
    };

    it("keeps a stored pick that still exists, else the first company by name on the first online Mac, and Other only when nothing else exists", () => {
      // Given two Macs; "Air" (m2) sorts first but is offline
      const offline = buildOverview({
        ...base,
        offlineMachineIds: new Set(["m2"]),
      });
      const keyOf = (overview: typeof offline, name: string) =>
        overview.macs
          .flatMap((mac) => mac.companies)
          .find((entry) => entry.company.name === name)?.company.key ?? null;

      // Then the default is alpha: the first by name on the first online Mac
      expect(resolveSelection(offline, null)).toBe(keyOf(offline, "alpha"));
      // And a stored pick that exists wins, one that does not falls back
      expect(resolveSelection(offline, keyOf(offline, "zeta"))).toBe(
        keyOf(offline, "zeta"),
      );
      expect(resolveSelection(offline, "m9\0/gone")).toBe(
        keyOf(offline, "alpha"),
      );

      // And with every Mac online the first Mac by name (Air) supplies the default
      const online = buildOverview({ ...base, offlineMachineIds: new Set() });
      expect(resolveSelection(online, null)).toBe(keyOf(online, "beta"));

      // And Other is picked only when it is the only company
      const onlyOther = buildOverview({
        ...base,
        folders: [{ machineId: "m1", path: "/w", companyMode: false }],
        sessions: [live("m1", "s", "/w", "idle")],
        offlineMachineIds: new Set(),
      });
      expect(resolveSelection(onlyOther, null)).toBe(
        onlyOther.macs.flatMap((mac) => mac.companies)[0].company.key,
      );
      expect(
        onlyOther.macs.flatMap((mac) => mac.companies)[0].company.other,
      ).toBe(true);

      // And no companies means no selection
      expect(
        resolveSelection(
          buildOverview({ ...base, folders: [], offlineMachineIds: new Set() }),
          null,
        ),
      ).toBeNull();
    });

    describe("default company with live sessions", () => {
      const keyOf = (
        overview: ReturnType<typeof buildOverview>,
        name: string,
      ) =>
        overview.macs
          .flatMap((mac) => mac.companies)
          .find((entry) => entry.company.name === name)?.company.key ?? null;
      const online = (sessions: SessionDto[]) =>
        buildOverview({ ...base, sessions, offlineMachineIds: new Set() });

      it("skips a first company that only has a folder record for the next one with a live session on the same Mac", () => {
        // Given one Mac whose first company by name (alpha) has only a folder record and whose second (zeta) is live
        const overview = buildOverview({
          ...base,
          folders: base.folders.filter((f) => f.machineId === "m1"),
          machines: base.machines.filter((m) => m.machineId === "m1"),
          sessions: [live("m1", "s", "/zeta/x", "working")],
          offlineMachineIds: new Set(),
        });

        // Then zeta is the default
        expect(resolveSelection(overview, null)).toBe(keyOf(overview, "zeta"));
      });

      it("moves to the next online Mac when the only live company is there", () => {
        // Given Air (m2, first by name) has no live session and Zed Mac (m1) has one in zeta
        const overview = online([live("m1", "s", "/zeta/x", "idle")]);

        // Then zeta on the second Mac wins over beta on the first
        expect(resolveSelection(overview, null)).toBe(keyOf(overview, "zeta"));
      });

      it("falls back to the first company by name when nothing is live", () => {
        // Given no sessions
        const overview = online([]);

        // Then the first by name on the first Mac is the default
        expect(resolveSelection(overview, null)).toBe(keyOf(overview, "beta"));
      });

      it("opens a live Other when no regular company is live, rather than an empty regular one", () => {
        // Given a quiet company (alpha) and a live session whose start folder is switched off
        const overview = buildOverview({
          ...base,
          folders: [
            { machineId: "m1", path: "/alpha", companyMode: true },
            { machineId: "m1", path: "/w", companyMode: false },
          ],
          machines: base.machines.filter((m) => m.machineId === "m1"),
          sessions: [live("m1", "s", "/w", "working")],
          offlineMachineIds: new Set(),
        });

        // Then Other is the default
        const other = overview.macs
          .flatMap((mac) => mac.companies)
          .find((entry) => entry.company.other);
        expect(resolveSelection(overview, null)).toBe(other?.company.key);
      });

      it("honours a pick restored from storage only while its company is active", () => {
        // Given zeta live, and beta (idle, no session today) picked in an earlier visit
        const overview = online([live("m1", "s", "/zeta/x", "working")]);
        const beta = keyOf(overview, "beta");

        // Then a restored pick of beta falls back to the live default
        expect(resolveSelection(overview, beta, { restored: true })).toBe(
          keyOf(overview, "zeta"),
        );
        // And a restored pick of a live company holds
        expect(
          resolveSelection(overview, keyOf(overview, "zeta"), {
            restored: true,
          }),
        ).toBe(keyOf(overview, "zeta"));
        // And a pick made in this page holds even for an idle company
        expect(resolveSelection(overview, beta)).toBe(beta);
      });

      it("keeps a stored pick over every live company", () => {
        // Given a live zeta and a stored pick of the idle beta
        const overview = online([live("m1", "s", "/zeta/x", "working")]);

        // Then the stored pick wins
        expect(resolveSelection(overview, keyOf(overview, "beta"))).toBe(
          keyOf(overview, "beta"),
        );
      });
    });
  });
});
