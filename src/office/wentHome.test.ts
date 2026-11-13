import { afterEach, describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import {
  searchableSessions,
  todaysDepartures,
  wentHomeRowsOf,
} from "./wentHome";

const ORIGINAL_TZ = process.env.TZ;

function ended(
  sessionId: string,
  endedAt: string,
  extra: Partial<SessionDto> = {},
): SessionDto {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/work",
    state: "wentHome",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt,
    hadPrompt: true,
    changedAt: endedAt,
    ...extra,
  };
}

/** Ids of today's departures as the list would show them. */
function idsAt(now: string, sessions: SessionDto[], zone: string): string[] {
  process.env.TZ = zone;
  return todaysDepartures(sessions, new Date(now)).map((s) => s.sessionId);
}

describe("today's departures", () => {
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("keeps prompted sessions that ended since the browser's local midnight, newest first, in any zone and across a DST day", () => {
    // Given sessions ended around local midnight in Ho Chi Minh City (UTC+7): 00:00 local is 17:00Z the day before
    const sessions = [
      ended("before-midnight", "2026-11-07T16:59:59.000Z"),
      ended("at-midnight", "2026-11-07T17:00:00.000Z"),
      ended("morning", "2026-11-08T02:00:00.000Z"),
      ended("never-prompted", "2026-11-08T03:00:00.000Z", {
        hadPrompt: false,
      }),
      ended("no-flag", "2026-11-08T03:30:00.000Z", { hadPrompt: undefined }),
      {
        ...ended("live", "2026-11-08T04:00:00.000Z"),
        endedAt: undefined,
        state: "working" as const,
      },
    ];

    // When it is 10:00 local, then 23:59 local, then just after midnight local
    // Then only the prompted departures since local midnight show, newest first, and midnight itself counts
    expect(
      idsAt("2026-11-08T03:00:00.000Z", sessions, "Asia/Ho_Chi_Minh"),
    ).toEqual(["morning", "at-midnight"]);
    expect(
      idsAt("2026-11-08T16:59:00.000Z", sessions, "Asia/Ho_Chi_Minh"),
    ).toEqual(["morning", "at-midnight"]);
    expect(
      idsAt("2026-11-08T17:00:00.000Z", sessions, "Asia/Ho_Chi_Minh"),
    ).toEqual([]);

    // And the same instants are a different day in Los Angeles (UTC-8): at 19:00 local on Nov 7 all three count
    expect(
      idsAt("2026-11-08T03:00:00.000Z", sessions, "America/Los_Angeles"),
    ).toEqual(["morning", "at-midnight", "before-midnight"]);

    // And on a 25-hour DST day (New York, 2026-11-01) a departure 24 h+ before now is still today
    const dst = [
      ended("early", "2026-11-01T04:10:00.000Z"),
      ended("yesterday", "2026-11-01T03:50:00.000Z"),
    ];
    expect(idsAt("2026-11-02T04:30:00.000Z", dst, "America/New_York")).toEqual([
      "early",
    ]);
  });
});

describe("the sessions a search reads", () => {
  it("keeps live sessions and today's departures, and drops yesterday's and never-prompted ended ones", () => {
    // Given a live session and three ended ones: today's, yesterday's and one that never got a prompt
    const now = new Date(2026, 10, 14, 15, 0);
    const today = new Date(2026, 10, 14, 9, 0).toISOString();
    const yesterday = new Date(2026, 10, 13, 20, 0).toISOString();
    const live = ended("live", today, {
      state: "idle",
      endedAt: undefined,
      hadPrompt: undefined,
    });
    const sessions = [
      ended("yesterday", yesterday),
      ended("silent", today, { hadPrompt: false }),
      ended("today", today),
      live,
    ];

    // When the search pool is made
    const ids = searchableSessions(sessions, now).map((s) => s.sessionId);

    // Then the live one comes first, then today's departure
    expect(ids).toEqual(["live", "today"]);
  });
});

describe("the went-home rows", () => {
  it("writes a departure's task, where it worked and when it went home", () => {
    // Given a departure with a card name in a project folder
    const at = new Date(2026, 10, 14, 9, 5).toISOString();
    const sessions = [ended("a", at, { deskName: "Fix ledger" })];

    // When the rows are made
    const rows = wentHomeRowsOf(sessions, () => ({
      companyKey: "k",
      companyName: "personal",
      project: "app",
    }));

    // Then the row names its task, place and time
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "m1/a",
      task: "Fix ledger",
      where: "Mac / personal/app",
      time: "09:05",
    });
  });

  it("leaves 'undefined' out of the place when the Mac is unknown", () => {
    // Given a departure whose Mac no company knows
    const at = new Date(2026, 10, 14, 9, 5).toISOString();

    // When the rows are made
    const [row] = wentHomeRowsOf([ended("a", at)], () => null);

    // Then the place is the Mac alone
    expect(row.where).toBe("Mac");
  });

  it("leaves the Mac out of the place when it has no name", () => {
    // Given a departure from a Mac with no name
    const at = new Date(2026, 10, 14, 9, 5).toISOString();
    const nameless = ended("a", at, { machineName: "" });

    // When the rows are made
    const [row] = wentHomeRowsOf([nameless], () => ({
      companyKey: "k",
      companyName: "personal",
      project: "app",
    }));

    // Then the place is the company and project alone
    expect(row.where).toBe("personal/app");
  });
});
