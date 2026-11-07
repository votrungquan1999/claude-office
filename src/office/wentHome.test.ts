import { afterEach, describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import { todaysDepartures } from "./wentHome";

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
