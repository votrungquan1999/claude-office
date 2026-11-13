// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDto } from "@/shared/session";
import { SearchPalette } from "./SearchPalette";

const session = (id: string, extra: Partial<SessionDto> = {}): SessionDto => ({
  machineId: "m1",
  machineName: "Mac",
  sessionId: id,
  cwd: `/Users/q/personal/${id}`,
  state: "idle",
  startedAt: "2026-11-14T00:00:00.000Z",
  changedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

function open(sessions: SessionDto[], onShow = vi.fn()) {
  render(
    <SearchPalette
      sessions={sessions}
      companyNameOf={() => "personal"}
      offlineMachineIds={new Set()}
      onShow={onShow}
      onClose={() => {}}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Find an employee" });
  return { input, onShow };
}

describe("the Cmd+K palette", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ignores the Enter that finishes an IME composition, also when the browser reports it only as key code 229", () => {
    // Given a palette with one match
    const { input, onShow } = open([session("a", { deskName: "Ledger" })]);
    fireEvent.change(input, { target: { value: "ledger" } });

    // When Safari reports the composition's Enter as keyCode 229 with no isComposing
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    // Then nothing is shown
    expect(onShow).not.toHaveBeenCalled();

    // When a plain Enter follows
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });

    // Then the match is shown
    expect(onShow).toHaveBeenCalledWith("m1/a");
  });

  it("writes when a match went home next to its state, as the Went home list does", () => {
    // Given a match that went home at 09:05 local time
    const endedAt = new Date(2026, 10, 14, 9, 5).toISOString();
    const { input } = open([
      session("gone", {
        deskName: "Ledger gone",
        state: "wentHome",
        hadPrompt: true,
        endedAt,
      }),
    ]);

    // When the owner searches it
    fireEvent.change(input, { target: { value: "ledger" } });

    // Then its row says when it went home
    expect(screen.getByRole("option").textContent).toContain("Went home 09:05");
  });

  it.each<[string, Partial<SessionDto>]>([
    ["went home", { state: "wentHome", hadPrompt: true }],
    ["not running", { notRunning: true }],
    ["launching", { waitingAtMac: true }],
  ])(
    "does not open Remote Control for a %s match, and says it is off",
    (_name, extra) => {
      // Given a match whose card shows no link although it still has a bridge id
      const open$ = vi.spyOn(window, "open").mockReturnValue(null);
      const { input } = open([
        session("a", {
          deskName: "Ledger",
          bridgeSessionId: "bridge-1",
          ...extra,
        }),
      ]);
      fireEvent.change(input, { target: { value: "ledger" } });

      // When the owner presses Cmd+Enter
      fireEvent.keyDown(input, { key: "Enter", keyCode: 13, metaKey: true });

      // Then no page opens and the row says Remote Control is off
      expect(open$).not.toHaveBeenCalled();
      expect(screen.getByRole("option").textContent).toContain(
        "Remote Control off",
      );
    },
  );
});
