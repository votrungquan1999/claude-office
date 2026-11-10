// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderStatus } from "./useOrderStatus";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("following an order", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls every 2 s while pending, calls back once when done, and stops polling", async () => {
    // Given an order that is pending, then claimed, then done
    fetchMock
      .mockResolvedValueOnce(answer({ status: "pending", ageMs: 100 }))
      .mockResolvedValueOnce(answer({ status: "claimed", ageMs: 2100 }))
      .mockResolvedValue(answer({ status: "done", ageMs: 4100 }));
    const onDone = vi.fn();

    // When the hook follows it
    const { result } = renderHook(() => useOrderStatus("o1", onDone));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ phase: "pending" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ phase: "pending" });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Then it ends done, called back once, and asks no more
    expect(result.current).toEqual({ phase: "done" });
    expect(onDone).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("reads a failure's reason, and calls a pending order older than 30 s by the database clock not sent", async () => {
    // Given an order that failed
    fetchMock.mockResolvedValue(
      answer({ status: "failed", reason: "folderMissing", ageMs: 500 }),
    );
    const failed = renderHook(() => useOrderStatus("o2"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(failed.result.current).toEqual({
      phase: "failed",
      reason: "folderMissing",
    });

    // And one still pending after 31 s of database time
    fetchMock.mockResolvedValue(answer({ status: "pending", ageMs: 31_000 }));
    const stale = renderHook(() => useOrderStatus("o3"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stale.result.current).toEqual({ phase: "notSent" });
  });

  it("keeps a pending order at 29 s of database time pending", async () => {
    fetchMock.mockResolvedValue(answer({ status: "pending", ageMs: 29_000 }));
    const { result } = renderHook(() => useOrderStatus("o4"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ phase: "pending" });
  });

  it("calls an order the office no longer knows not sent", async () => {
    fetchMock.mockResolvedValue(answer({ error: "not found" }, 404));
    const { result } = renderHook(() => useOrderStatus("gone"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ phase: "notSent" });
  });

  it("reports lost contact, not not-sent, after 35 s without an answer from the office", async () => {
    // Given an office that never answers
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useOrderStatus("o5"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(34_000);
    });
    expect(result.current).toEqual({ phase: "pending" });

    // When 35 s have passed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Then the owner is told contact was lost, and polling stops
    expect(result.current).toEqual({ phase: "lostContact" });
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("counts the 35 s from the last answer, so a flicker does not end the wait", async () => {
    fetchMock.mockResolvedValueOnce(answer({ status: "pending", ageMs: 100 }));
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useOrderStatus("o6"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    fetchMock.mockResolvedValue(answer({ status: "claimed", ageMs: 31_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current).toEqual({ phase: "pending" });
  });

  it("stops and tells the owner to check the Mac when an order is still claimed after 2 minutes", async () => {
    fetchMock.mockResolvedValue(answer({ status: "claimed", ageMs: 119_000 }));
    const { result } = renderHook(() => useOrderStatus("o7"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ phase: "pending" });

    fetchMock.mockResolvedValue(answer({ status: "claimed", ageMs: 121_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current).toEqual({ phase: "checkMac" });
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("ignores a stale answer for an older order under a newer order id", async () => {
    // Given the first order's answer arrives late, after the owner moved to a second order
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    fetchMock.mockResolvedValue(answer({ status: "claimed", ageMs: 500 }));
    const { result, rerender } = renderHook(({ id }) => useOrderStatus(id), {
      initialProps: { id: "old" },
    });
    rerender({ id: "new" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // When the older answer finally says failed
    await act(async () => {
      release(answer({ status: "failed", reason: "folderMissing", ageMs: 1 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Then the newer order still shows pending
    expect(result.current).toEqual({ phase: "pending" });
  });
});
