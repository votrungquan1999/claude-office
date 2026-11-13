import { describe, expect, it } from "vitest";
import { needsYouCount, selectNeedsYou } from "./needs-you";
import type { SessionDto } from "./session";

describe("the needs-you count", () => {
  it("adds Needs permission, Waiting for you and Review, and leaves out Working and Idle", () => {
    // Given a company with every kind of employee
    const counts = {
      working: 5,
      needsPermission: 2,
      waitingForYou: 3,
      review: 4,
      idle: 9,
    };

    // Then only the three rooms that ask something of the owner add up
    expect(needsYouCount(counts)).toBe(9);
  });
});

function session(
  sessionId: string,
  state: SessionDto["state"],
  extra: Partial<SessionDto> = {},
): SessionDto {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/x",
    state,
    startedAt: `2026-11-0${sessionId.length}T00:00:00.000Z`,
    changedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

describe("selecting who needs the owner", () => {
  it("lists the viewed company's rows in the owner's order, other companies grouped in the strip's order, and leaves out working, idle, went-home and offline-Mac employees", () => {
    // Given employees in three companies, two states that never need the owner, and one on an offline Mac
    const rows = [
      session("a", "waitingForYou", { rank: "d" }),
      session("b", "review", {
        rank: "b",
        stateSince: "2026-11-01T01:00:00.000Z",
      }),
      session("c", "working", { rank: "c" }),
      session("d", "needsPermission", { rank: "c" }),
      session("e", "idle"),
      session("f", "wentHome"),
      session("g", "review", {
        machineId: "m2",
        rank: "a",
        stateSince: "2026-11-01T02:00:00.000Z",
      }),
      session("h", "waitingForYou", { machineId: "m3" }),
      session("i", "needsPermission", { machineId: "m9" }),
    ];
    const companyOf = (s: SessionDto) => ({
      companyKey: s.machineId === "m1" ? "m1/home" : `${s.machineId}/home`,
      companyName: `Company ${s.machineId}`,
    });

    // When Needs you is selected for the first company
    const result = selectNeedsYou({
      sessions: rows,
      companyOf,
      viewedCompany: "m1/home",
      companyOrder: ["m1/home", "m3/home", "m2/home", "m9/home"],
      offlineMachineIds: new Set(["m9"]),
      includeOtherCompanies: true,
    });

    // Then own rows follow the order, other companies follow the strip, and the offline Mac is absent
    expect(result.own.map((r) => r.sessionId)).toEqual(["b", "d", "a"]);
    expect(
      result.others.map((g) => [g.companyKey, g.rows.map((r) => r.sessionId)]),
    ).toEqual([
      ["m3/home", ["h"]],
      ["m2/home", ["g"]],
    ]);
    expect(result.total).toBe(5);
    expect(result.reviewItems).toEqual([
      {
        machineId: "m1",
        sessionId: "b",
        stateSince: "2026-11-01T01:00:00.000Z",
      },
      {
        machineId: "m2",
        sessionId: "g",
        stateSince: "2026-11-01T02:00:00.000Z",
      },
    ]);
  });

  it("keeps an employee's place when it changes from Waiting for you to Review", () => {
    // Given three placed employees, the middle one waiting for the owner
    const pick = (middle: SessionDto["state"]) =>
      selectNeedsYou({
        sessions: [
          session("a", "waitingForYou", { rank: "a" }),
          session("b", middle, {
            rank: "b",
            stateSince: "2026-11-01T01:00:00Z",
          }),
          session("c", "needsPermission", { rank: "c" }),
        ],
        companyOf: () => ({ companyKey: "m1/home", companyName: "home" }),
        viewedCompany: "m1/home",
        companyOrder: ["m1/home"],
        offlineMachineIds: new Set(),
        includeOtherCompanies: true,
      }).own.map((r) => r.sessionId);
    expect(pick("waitingForYou")).toEqual(["a", "b", "c"]);

    // When it finishes and goes to Review
    // Then it is still between the other two
    expect(pick("review")).toEqual(["a", "b", "c"]);
  });
});

describe("companies the strip does not list, and Review rows with a time", () => {
  const inputFor = (rows: SessionDto[], companyOrder: string[]) => ({
    sessions: rows,
    companyOf: (s: SessionDto) => ({
      companyKey: `${s.machineId}/home`,
      companyName: s.machineId,
    }),
    viewedCompany: "m1/home",
    companyOrder,
    offlineMachineIds: new Set<string>(),
    includeOtherCompanies: true,
  });

  it("puts a company the strip does not list after the listed ones, even when its name sorts first", () => {
    // Given other companies where only m3 is in the strip, and the unlisted one sorts first by name
    const rows = [
      session("a", "waitingForYou", { machineId: "m1" }),
      session("b", "waitingForYou", { machineId: "m3" }),
      session("c", "waitingForYou", { machineId: "m0" }),
    ];

    // When Needs you is selected
    const result = selectNeedsYou(inputFor(rows, ["m1/home", "m3/home"]));

    // Then the listed company comes first and the unlisted one after it
    expect(result.others.map((g) => g.companyKey)).toEqual([
      "m3/home",
      "m0/home",
    ]);
  });
});
