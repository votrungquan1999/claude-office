import { describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import { searchPhoneList } from "./phoneSearch";

const session = (id: string, extra: Partial<SessionDto> = {}): SessionDto => ({
  machineId: "m1",
  machineName: "Air",
  sessionId: id,
  cwd: `/Users/q/personal/${id}`,
  state: "idle",
  startedAt: "2026-11-14T00:00:00.000Z",
  changedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

const ids = (hits: Array<{ session: SessionDto }>) =>
  hits.map((hit) => hit.session.sessionId);

describe("searching the phone's list", () => {
  it("keeps the matches in the order given, lists the viewed company's went-home matches apart, and leaves other companies out until asked", () => {
    // Given the viewed company in the owner's order (z first), a departure and another company, all holding "sync"
    const input = {
      query: "sync",
      own: [
        session("z", { deskName: "Sync zed" }),
        session("none", { deskName: "Unrelated" }),
        session("a", { deskName: "Sync alpha" }),
      ],
      departures: [
        session("gone", { deskName: "Sync gone", state: "wentHome" }),
      ],
      others: [
        {
          companyKey: "work-key",
          companyName: "work",
          sessions: [session("w", { deskName: "Sync work" })],
        },
      ],
      includeOthers: false,
    };

    // When searching only the viewed company
    const own = searchPhoneList(input);

    // Then its matches stay in the owner's order, the departure is listed apart, and nothing from work shows
    expect(ids(own.own)).toEqual(["z", "a"]);
    expect(ids(own.wentHome)).toEqual(["gone"]);
    expect(own.others).toEqual([]);
    expect(own.total).toBe(3);
    expect(own.own[0].match.field).toBe("name");

    // When the owner asks for every company
    const all = searchPhoneList({ ...input, includeOthers: true });

    // Then work's match joins under its company and the total counts it
    expect(all.others.map((group) => group.companyName)).toEqual(["work"]);
    expect(ids(all.others[0].hits)).toEqual(["w"]);
    expect(all.total).toBe(4);
  });
});
