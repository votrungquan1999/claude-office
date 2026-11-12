// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangesResponse } from "@/shared/session";
import { useOfficeChanges } from "./useOfficeChanges";

const INTERVAL = 3000;
const DAY_START = "2026-11-08T00:00:00.000Z";

function answer(cursor: string): ChangesResponse {
  return {
    sessions: [],
    machines: [],
    folders: [],
    cursor,
    serverNow: "2026-11-08T10:00:00.000Z",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Calls the fake network saw, as the query strings of their URLs. */
function queries(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url).split("?")[1] ?? "");
}

/** Hides or shows the tab the way a browser does: the state changes, then the event fires. */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("the office polls for changes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount() {
    const onAnswer = vi.fn();
    const onUnauthorized = vi.fn();
    const hook = renderHook(() =>
      useOfficeChanges({
        enabled: true,
        intervalMs: INTERVAL,
        dayStart: DAY_START,
        onAnswer,
        onUnauthorized,
      }),
    );
    return { ...hook, onAnswer, onUnauthorized };
  }

  it("loads at once with the day start, then asks again after every interval from the cursor of the last answer", async () => {
    // Given a server that moves its cursor forward on each answer
    fetchMock
      .mockImplementationOnce(async () => json(answer("c1")))
      .mockImplementationOnce(async () => json(answer("c2")))
      .mockImplementation(async () => json(answer("c3")));

    // When the office mounts and time passes for two intervals
    const { onAnswer } = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));

    // Then the first call carries the day start and the later ones the previous cursor
    expect(queries(fetchMock)).toEqual([
      `dayStart=${encodeURIComponent(DAY_START)}`,
      "since=c1",
      "since=c2",
    ]);
    expect(onAnswer.mock.calls.map(([, first]) => first)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("numbers each poll as it starts and hands the number to its answer, so a caller can tell polls started before an event from those after", async () => {
    // Given a server whose second answer is held until released
    let release: () => void = () => {};
    fetchMock
      .mockImplementationOnce(async () => json(answer("c1")))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(json(answer("c2")));
          }),
      )
      .mockImplementation(async () => json(answer("c3")));

    // When the first poll has answered and the second has started
    const { result, onAnswer } = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));

    // Then the second poll counts as started before it answers
    expect(result.current.lastStartedPoll()).toBe(2);
    expect(onAnswer.mock.calls.map(([, , poll]) => poll)).toEqual([1]);

    // And its answer and the next carry their own numbers
    await act(async () => release());
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    expect(onAnswer.mock.calls.map(([, , poll]) => poll)).toEqual([1, 2, 3]);
  });

  it("stops asking while the tab is hidden, asks at once when it comes back, and then carries on every interval", async () => {
    // Given an office that has loaded
    fetchMock.mockImplementation(async () => json(answer("c1")));
    mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // When the tab is hidden for ten intervals
    act(() => setVisibility("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 10));

    // Then nothing was asked
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // When the tab comes back
    act(() => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Then it asks at once, from the cursor it already had
    expect(queries(fetchMock)).toEqual([
      `dayStart=${encodeURIComponent(DAY_START)}`,
      "since=c1",
    ]);

    // And carries on one call per interval
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 2));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("never starts a poll while the previous one is still waiting, and pauses one interval after it settles", async () => {
    // Given a server that takes a long time to answer the first call
    let release: (response: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (release = resolve)),
      )
      .mockImplementation(async () => json(answer("c2")));
    mount();
    await act(() => vi.advanceTimersByTimeAsync(0));

    // When five intervals pass with no answer
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 5));

    // Then still only the first call was made
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // When it answers
    await act(async () => release(json(answer("c1"))));
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL - 1));

    // Then the next call waits a full interval from the answer
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(queries(fetchMock)).toEqual([
      `dayStart=${encodeURIComponent(DAY_START)}`,
      "since=c1",
    ]);
  });

  it("keeps its cursor through a failed poll, says the connection is lost, backs off, and recovers on the next answer", async () => {
    // Given a server that answers, then fails with a network error and a 500, then answers again
    fetchMock
      .mockImplementationOnce(async () => json(answer("c1")))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockImplementationOnce(async () => json({ error: "boom" }, 500))
      .mockImplementation(async () => json(answer("c2")));
    const { result, onAnswer } = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.connectionLost).toBe(false);
    expect(result.current.lastUpdatedAt).not.toBeNull();

    // When the next poll fails
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));

    // Then the connection is lost, and the retry waits longer than one interval
    expect(result.current.connectionLost).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // When that retry fails too and the one after works
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL * 4));

    // Then the cursor never moved past the last good answer, and the connection is back
    expect(queries(fetchMock).slice(1)).toEqual([
      "since=c1",
      "since=c1",
      "since=c1",
    ]);
    expect(result.current.connectionLost).toBe(false);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it("stops polling and reports it once when the session has expired", async () => {
    // Given a server that signs the owner out after the first answer
    fetchMock
      .mockImplementationOnce(async () => json(answer("c1")))
      .mockImplementation(async () => json({ error: "Not signed in" }, 401));
    const { onUnauthorized } = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));

    // When the next poll is refused and a minute passes
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    // Then it was reported once and nothing more was asked
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("treats a poll that never answers as failed after 10 seconds, says the connection is lost, and backs off", async () => {
    // Given timeout signals driven by the fake clock (the real ones use Node's own timers)
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const timeout = new AbortController();
      setTimeout(
        () => timeout.abort(new DOMException("timed out", "TimeoutError")),
        ms,
      );
      return timeout.signal;
    });
    // And a server that answers once, then holds the next request open until it is aborted
    fetchMock
      .mockImplementationOnce(async () => json(answer("c1")))
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            ),
          ),
      )
      .mockImplementation(async () => json(answer("c2")));
    const { result } = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));

    // When the hanging poll has waited just under 10 seconds
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    await act(() => vi.advanceTimersByTimeAsync(9_900));

    // Then it is still waiting
    expect(result.current.connectionLost).toBe(false);

    // When the 10 seconds are up
    await act(() => vi.advanceTimersByTimeAsync(200));

    // Then the connection is reported lost
    expect(result.current.connectionLost).toBe(true);

    // And the retry waits longer than one interval
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(INTERVAL));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.connectionLost).toBe(false);
  });
});
