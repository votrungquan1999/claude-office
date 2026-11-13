import { describe, expect, it } from "vitest";
import {
  CloseOutcome,
  type TerminalControl,
  TerminalControlError,
  TerminalFailure,
  type TerminalWindow,
} from "./terminal-control";
import { closeWhenIdle, WINDOW_NOTES } from "./window-close";

const WINDOW: TerminalWindow = { id: 7001, tty: "/dev/ttys003" };
const WAITS = { busyLimitMs: 60, controlLimitMs: 100, pollMs: 10 };

/** A Terminal whose tab is busy until `idleWhen` says otherwise, recording every close. */
function terminal(idleWhen: () => boolean) {
  const closes: number[] = [];
  const control: TerminalControl = {
    findWindow: async () => WINDOW,
    isBusy: async () => !idleWhen(),
    close: async (window) => {
      if (!idleWhen()) throw new Error("closed while busy");
      closes.push(window.id);
      return CloseOutcome.Closed;
    },
  };
  return { control, closes };
}

describe("closing a window once its tab is idle", () => {
  it("sweeps what is left on the tab once after the first wait, then closes when that made it idle, and never closes before", async () => {
    // Given a tab that stays busy until the sweep ends what runs on it
    let swept = 0;
    const { control, closes } = terminal(() => swept > 0);

    // When it is closed with a sweep
    const note = await closeWhenIdle(control, WINDOW, WAITS, async () => {
      swept += 1;
    });

    // Then the sweep ran exactly once, the window closed and no note is left
    expect(swept).toBe(1);
    expect(closes).toEqual([7001]);
    expect(note).toBeUndefined();
  });

  it("leaves a tab that is still busy after the sweep open and says why", async () => {
    // Given a tab nothing ever empties
    let swept = 0;
    const { control, closes } = terminal(() => false);

    // When it is closed with a sweep
    const note = await closeWhenIdle(control, WINDOW, WAITS, async () => {
      swept += 1;
    });

    // Then it was swept once, never closed, and the note says something still runs
    expect(swept).toBe(1);
    expect(closes).toEqual([]);
    expect(note).toBe(WINDOW_NOTES.busy);
  });
});

describe("a window that cannot be closed for a reason that is not the owner's", () => {
  it("is left open with the note that it holds other tabs", async () => {
    // Given an idle tab in a window with other tabs
    const control: TerminalControl = {
      findWindow: async () => WINDOW,
      isBusy: async () => false,
      close: async () => CloseOutcome.OtherTabs,
    };

    // When it is closed
    const note = await closeWhenIdle(control, WINDOW, WAITS);

    // Then the note says so
    expect(note).toBe(WINDOW_NOTES.otherTabs);
  });

  it("is left open with a generic note when Terminal fails in any other way", async () => {
    // Given a Terminal whose calls fail generically
    const control: TerminalControl = {
      findWindow: async () => WINDOW,
      isBusy: async () => {
        throw new TerminalControlError(TerminalFailure.Failed);
      },
      close: async () => CloseOutcome.Closed,
    };

    // When it is closed
    const note = await closeWhenIdle(control, WINDOW, WAITS);

    // Then the note is the generic one, not the permission one
    expect(note).toBe(WINDOW_NOTES.failed);
  });
});

describe("a Terminal that never answers", () => {
  it("is cut off by the time limit, so the window stays open with the permission note and nothing is closed", async () => {
    // Given a Terminal whose busy check never settles, as while a permission prompt is open
    const closes: number[] = [];
    const control: TerminalControl = {
      findWindow: async () => WINDOW,
      isBusy: () => new Promise<boolean>(() => {}),
      close: async (window) => {
        closes.push(window.id);
        return CloseOutcome.Closed;
      },
    };

    // When the window is closed with a short control limit
    const note = await closeWhenIdle(control, WINDOW, {
      ...WAITS,
      controlLimitMs: 30,
    });

    // Then the call returned with the permission note and no close was attempted
    expect(note).toBe(WINDOW_NOTES.notPermitted);
    expect(closes).toEqual([]);
  });
});
