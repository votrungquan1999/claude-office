// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SessionDto, sessionKey } from "@/shared/session";
import type { ReviewMoves } from "../reviewSeen";
import { useReviewMoves } from "./useReviewMoves";

const SINCE = "2026-11-09T09:00:00.000Z";
const session: SessionDto = {
  machineId: "m1",
  machineName: "Mac",
  sessionId: "s1",
  cwd: "/work",
  state: "review",
  stateSince: SINCE,
  startedAt: SINCE,
  changedAt: SINCE,
};
const key = sessionKey(session);

/** Runs the hook against a one-session store whose moves the test can read. */
function setUp() {
  let moves: ReviewMoves = new Map();
  const hook = renderHook(() =>
    useReviewMoves({
      getSessions: () => new Map([[key, session]]),
      getMoves: () => moves,
      setMoves: (next) => {
        moves = next;
      },
      serverOffsetMs: 0,
    }),
  );
  return { hook, moves: () => moves };
}

describe("moving a Review to Idle when the server finds nothing to mark", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes the Idle overlay back at once and shows no refusal", async () => {
    // Given a server that took the request but marked no row (the Review had already moved on)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ marked: 0 })),
    );
    const { hook, moves } = setUp();

    // When the owner moves the Review to Idle
    await act(() => hook.result.current.moveReviewsToIdle([key]));

    // Then the overlay is gone and no failure message is raised
    expect(moves().has(key)).toBe(false);
    expect(hook.result.current.refused.keys.size).toBe(0);
  });
});

describe("moving a list of Reviews when some already left Review", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the rows still in Review, and shows no refusal", async () => {
    // Given one Review row and one that went back to work since the list was drawn
    const moved: SessionDto = { ...session, sessionId: "s2", state: "working" };
    const fetchMock = vi.fn(async () => Response.json({ marked: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    let moves: ReviewMoves = new Map();
    const hook = renderHook(() =>
      useReviewMoves({
        getSessions: () =>
          new Map([
            [key, session],
            [sessionKey(moved), moved],
          ]),
        getMoves: () => moves,
        setMoves: (next) => {
          moves = next;
        },
        serverOffsetMs: 0,
      }),
    );

    // When the owner moves both
    await act(() =>
      hook.result.current.moveReviewsToIdle([key, sessionKey(moved)], true),
    );

    // Then one request names only the Review row, and nothing was refused
    const body = JSON.parse(
      String(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body,
      ),
    );
    expect(body.items).toEqual([
      { machineId: "m1", sessionId: "s1", stateSince: SINCE },
    ]);
    expect(hook.result.current.refused.keys.size).toBe(0);
    expect(moves.has(sessionKey(moved))).toBe(false);
  });
});
