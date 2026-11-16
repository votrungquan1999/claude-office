// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineDto } from "@/shared/session";
import { useAgentRestarts } from "./useAgentRestarts";

const AIR: MachineDto = {
  machineId: "air",
  machineName: "Air",
  lastSeenAt: "2026-11-16T09:40:00.000Z",
  agentVersion: "0.5.0",
  agentStartedAt: "2026-11-16T09:30:00.000Z",
};

describe("following a restart asked for from Settings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the agent has not come back once a minute passes with no new start time", async () => {
    // Given a restart the server accepted
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const pressedAt = Date.now();
    const { result, rerender } = renderHook(
      ({ now }) => useAgentRestarts(now),
      { initialProps: { now: pressedAt } },
    );
    await act(() => result.current.restart(AIR));

    // When 59 s pass, then 61 s, with the same start time
    rerender({ now: pressedAt + 59_000 });
    const early = result.current.viewOf(AIR);
    rerender({ now: pressedAt + 61_000 });

    // Then it is restarting at first and has not come back after the minute
    expect(early).toEqual({ phase: "restarting" });
    expect(result.current.viewOf(AIR)).toEqual({ phase: "notBack" });
  });

  it("carries the server's refusal, so the owner sees why nothing restarts", async () => {
    // Given the server refuses because the Mac went quiet
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "That Mac is offline." }), {
        status: 409,
      }),
    );
    const { result } = renderHook(() => useAgentRestarts(Date.now()));

    // When the owner asks for a restart
    await act(() => result.current.restart(AIR));

    // Then the refusal is shown
    expect(result.current.viewOf(AIR)).toEqual({
      phase: "refused",
      error: "That Mac is offline.",
    });
  });
});
