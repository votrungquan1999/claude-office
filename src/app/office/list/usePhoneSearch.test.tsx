// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import { usePhoneSearch } from "./usePhoneSearch";

const session = (id: string, extra: Partial<SessionDto> = {}): SessionDto => ({
  machineId: "m1",
  machineName: "Air",
  sessionId: id,
  cwd: `/Users/q/work/${id}`,
  state: "idle",
  startedAt: "2026-11-14T00:00:00.000Z",
  changedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

describe("the phone's search of all companies", () => {
  it("lists another company's departures after its live matches, even when they started later", () => {
    // Given work holding a live match that started early and a departure that started later
    const live = session("live", {
      deskName: "Sync live",
      startedAt: "2026-11-14T01:00:00.000Z",
    });
    const gone = session("gone", {
      deskName: "Sync gone",
      state: "wentHome",
      startedAt: "2026-11-14T08:00:00.000Z",
      endedAt: "2026-11-14T09:00:00.000Z",
      hadPrompt: true,
    });
    const { result } = renderHook(() =>
      usePhoneSearch({
        viewedCompanyKey: "personal",
        own: [],
        departures: [],
        sessions: [gone, live],
        companyOf: () => ({ companyKey: "work", companyName: "work" }),
        companyOrder: ["personal", "work"],
      }),
    );

    // When the owner searches every company
    act(() => result.current.setQuery("sync"));
    act(() => result.current.searchAll());

    // Then the live match comes before the departure
    const hits = result.current.result?.others[0].hits ?? [];
    expect(hits.map((hit) => hit.session.sessionId)).toEqual(["live", "gone"]);
  });
});
