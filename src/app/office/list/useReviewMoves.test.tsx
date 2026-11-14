// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SessionDto, sessionKey } from "@/shared/session";
import { applyReviewMoves, type ReviewMoves } from "../reviewSeen";
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

describe("moving an Idle employee to Review", () => {
  afterEach(() => vi.unstubAllGlobals());
  const idle: SessionDto = { ...session, state: "idle" };

  /** Runs the hook against the Idle session, with the given server answer. */
  function setUpIdle(answer: () => Response) {
    const fetchMock = vi.fn(async () => answer());
    vi.stubGlobal("fetch", fetchMock);
    let moves: ReviewMoves = new Map();
    const hook = renderHook(() =>
      useReviewMoves({
        getSessions: () => new Map([[key, idle]]),
        getMoves: () => moves,
        setMoves: (next) => {
          moves = next;
        },
        serverOffsetMs: 0,
      }),
    );
    return { hook, fetchMock, moves: () => moves };
  }

  it("sends one request naming the Idle the owner saw and keeps it shown as Review", async () => {
    // Given a server that marks the row
    const { hook, fetchMock, moves } = setUpIdle(() =>
      Response.json({ marked: 1 }),
    );

    // When the owner moves the Idle employee to Review
    await act(() => hook.result.current.moveIdleToReview(key));

    // Then one request names that Idle, and the move stays until an answer shows it
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/office/sessions/to-review");
    expect(JSON.parse(String(init.body))).toEqual({
      machineId: "m1",
      sessionId: "s1",
      stateSince: SINCE,
    });
    expect(moves().get(key)).toMatchObject({ to: "review", stateSince: SINCE });
  });

  it("puts the Idle back with a refusal when the server refuses, and quietly when it marked nothing", async () => {
    // Given a server that refuses
    const refusing = setUpIdle(() => new Response("{}", { status: 500 }));

    // When the owner moves the Idle employee to Review
    await act(() => refusing.hook.result.current.moveIdleToReview(key));

    // Then the move is taken back and the refusal names this employee's move to Review
    expect(refusing.moves().has(key)).toBe(false);
    expect(refusing.hook.result.current.refused).toMatchObject({
      keys: new Set([key]),
      to: "review",
    });

    // And with a server that marks nothing, the move is taken back with no refusal
    vi.unstubAllGlobals();
    const stale = setUpIdle(() => Response.json({ marked: 0 }));
    await act(() => stale.hook.result.current.moveIdleToReview(key));
    expect(stale.moves().has(key)).toBe(false);
    expect(stale.hook.result.current.refused.keys.size).toBe(0);
  });
});

describe("taking a move back before any answer shows it", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the hook against one session, with a server that marks every row. */
  function setUpWith(shown: SessionDto) {
    const fetchMock = vi.fn(async () => Response.json({ marked: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    let moves: ReviewMoves = new Map();
    const sessions = new Map([[key, shown]]);
    const hook = renderHook(() =>
      useReviewMoves({
        getSessions: () => sessions,
        getMoves: () => moves,
        setMoves: (next) => {
          moves = next;
        },
        serverOffsetMs: 0,
      }),
    );
    const lastRequest = () => {
      const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [
        string,
        RequestInit,
      ];
      return [url, JSON.parse(String(init.body))];
    };
    const state = () => applyReviewMoves(sessions, moves).get(key)?.state;
    return { hook, lastRequest, state };
  }

  it("moves an Idle the owner just moved to Review back to Idle, and a Review just moved to Idle back to Review, naming the time the answers hold", async () => {
    // Given an Idle employee the owner just moved to Review
    const raised = setUpWith({ ...session, state: "idle" });
    await act(() => raised.hook.result.current.moveIdleToReview(key));

    // When the owner moves it to Idle before any answer shows Review
    await act(() => raised.hook.result.current.moveReviewsToIdle([key]));

    // Then the request names its Idle time and it shows Idle
    expect(raised.lastRequest()).toEqual([
      "/api/office/sessions/review-seen",
      { items: [{ machineId: "m1", sessionId: "s1", stateSince: SINCE }] },
    ]);
    expect(raised.state()).toBe("idle");

    // And a Review the owner just moved to Idle goes back to Review the same way
    vi.unstubAllGlobals();
    const cleared = setUpWith(session);
    await act(() => cleared.hook.result.current.moveReviewsToIdle([key]));
    await act(() => cleared.hook.result.current.moveIdleToReview(key));
    expect(cleared.lastRequest()).toEqual([
      "/api/office/sessions/to-review",
      { machineId: "m1", sessionId: "s1", stateSince: SINCE },
    ]);
    expect(cleared.state()).toBe("review");
  });
});
