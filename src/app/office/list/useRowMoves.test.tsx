// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDto } from "@/shared/session";
import type { PendingRanks } from "./pendingRanks";
import { useRowMoves } from "./useRowMoves";

const row = (sessionId: string): SessionDto => ({
  machineId: "m1",
  machineName: "Mac",
  sessionId,
  cwd: "/work",
  state: "idle",
  startedAt: "2026-11-09T09:00:00.000Z",
  changedAt: "2026-11-09T09:00:00.000Z",
});

describe("the refusal of a move", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("goes away when the owner switches company", async () => {
    // Given a server that refuses a move
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const rows = [row("a"), row("b")];
    const hook = renderHook(
      ({ companyKey }) =>
        useRowMoves({
          getRanks: () => new Map(),
          setRanks: () => {},
          lastStartedPoll: () => 0,
          viewedRows: () => ({ rows, matches: () => true }),
          companyKey,
        }),
      { initialProps: { companyKey: "one" } },
    );
    await act(() => hook.result.current.moveRow("m1/a", "m1/b"));
    expect(hook.result.current.rankError).toBe("Could not move. Try again.");

    // When the owner switches to another company
    hook.rerender({ companyKey: "two" });

    // Then the alert is gone
    expect(hook.result.current.rankError).toBeNull();
  });
});

describe("moving a row to the top or the bottom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the row's place after the last row for the bottom and before the first for the top", async () => {
    // Given a company of three rows and a server that accepts moves
    const sent: Array<{ items: Array<{ sessionId: string; rank: string }> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response("{}", { status: 200 });
      }),
    );
    const rows = [
      { ...row("a"), rank: "m" },
      { ...row("b"), rank: "n" },
      { ...row("c"), rank: "o" },
    ];
    const hook = renderHook(() =>
      useRowMoves({
        getRanks: () => new Map(),
        setRanks: () => {},
        lastStartedPoll: () => 0,
        viewedRows: () => ({ rows, matches: () => true }),
        companyKey: "one",
      }),
    );

    // When the first row is moved to the bottom
    await act(() => hook.result.current.moveToEnd("m1/a", "bottom"));

    // Then its rank sorts after the last row's
    const bottom = sent[0]?.items[0];
    expect(bottom?.sessionId).toBe("a");
    expect(bottom?.rank && bottom.rank > "o").toBe(true);

    // When the last row is moved to the top
    await act(() => hook.result.current.moveToEnd("m1/c", "top"));

    // Then its rank sorts before the first row's
    const top = sent[1]?.items[0];
    expect(top?.sessionId).toBe("c");
    expect(top?.rank && top.rank < "m").toBe(true);
  });

  it("marks the places stored with the last started poll once the server took them", async () => {
    // Given a server that accepts moves and a page whose poll 7 was the last started
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    let ranks: PendingRanks = new Map();
    const hook = renderHook(() =>
      useRowMoves({
        getRanks: () => ranks,
        setRanks: (next) => {
          ranks = next;
        },
        lastStartedPoll: () => 7,
        viewedRows: () => ({
          rows: [
            { ...row("a"), rank: "m" },
            { ...row("b"), rank: "n" },
          ],
          matches: () => true,
        }),
        companyKey: "one",
      }),
    );

    // When a row is moved
    await act(() => hook.result.current.moveToEnd("m1/a", "bottom"));

    // Then its pending place records poll 7
    expect(ranks.get("m1/a")?.storedAfterPoll).toBe(7);
  });
});
