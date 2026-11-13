import { sleep } from "./helpers";
import {
  CloseOutcome,
  type TerminalControl,
  TerminalControlError,
  TerminalFailure,
  type TerminalWindow,
} from "./terminal-control";

/** The limits of one window close. */
export interface CloseWaits {
  /** Longest wait for the tab to stop being busy. */
  busyLimitMs: number;
  /** Longest wait for one call to Terminal. */
  controlLimitMs: number;
  /** How often a wait looks again. */
  pollMs: number;
}

/** The owner-facing note for a window that stays open, or undefined when it was closed. */
export type CloseNote = string | undefined;

/** The reasons a window stays open, in the owner's words. */
export const WINDOW_NOTES = {
  notPermitted:
    "Ended, but its Terminal window stays open: allow Claude Office to control Terminal at the Mac (System Settings, Privacy & Security, Automation), or close the window yourself.",
  busy: "Its Terminal window stays open because something is still running in it. Close it yourself.",
  notFound:
    "Ended, but its Terminal window could not be found. Close it yourself if it is still open.",
  leftRunning:
    "Stopped keeping this desk. Its conversation was left running because Claude Office cannot tell it runs in the window it opened.",
  notAsked:
    "Stopped keeping this desk. Its conversation was left running because the page that sent Dismiss did not warn you first; reload the page to end conversations with Dismiss.",
  noWindowId:
    "Stopped keeping this desk, but its Terminal window stays open because Claude Office cannot tell which window was its own. Close it yourself.",
  otherTabs:
    "Ended, but its Terminal window stays open because it holds other tabs. Close it yourself if you are done with them.",
  listFailed:
    "Stopped keeping this desk, but the Mac's process list could not be read, so Claude Office cannot tell whether its conversation ended or close its Terminal window. Check the window yourself.",
  failed:
    "Ended, but its Terminal window stays open: Terminal could not be controlled. Close it yourself.",
} as const;

/**
 * The note for a Terminal that could not be driven.
 * @param error - What the control threw.
 * @returns The refusal or timeout note, or the generic one for any other failure.
 */
export function controlFailureNote(error: TerminalControlError): string {
  return error.failure === TerminalFailure.Failed
    ? WINDOW_NOTES.failed
    : WINDOW_NOTES.notPermitted;
}

/**
 * Runs one call to Terminal with a time limit; a prompt the owner has not answered would otherwise block it for a minute.
 * @param call - The call.
 * @param limitMs - How long it may take.
 * @returns What the call returned.
 * @throws TerminalControlError when the limit passes first.
 */
export async function withLimit<T>(
  call: Promise<T>,
  limitMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TerminalControlError(TerminalFailure.TimedOut)),
          limitMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Closes a window once its tab is idle, unless it holds other tabs; never while busy, because that makes Terminal ask about running processes and then ignore later closes.
 * @param control - Terminal.
 * @param window - The conversation's window.
 * @param waits - The limits.
 * @param sweep - Called once if the tab is still busy after the limit, to end what is left on it; the wait then starts over.
 * @returns A note saying why the window stays open, or undefined when it was closed.
 */
export async function closeWhenIdle(
  control: TerminalControl,
  window: TerminalWindow,
  waits: CloseWaits,
  sweep?: () => Promise<void>,
): Promise<CloseNote> {
  try {
    let deadline = Date.now() + waits.busyLimitMs;
    let swept = false;
    while (await withLimit(control.isBusy(window), waits.controlLimitMs)) {
      if (Date.now() >= deadline) {
        // A process spawned after the snapshot keeps the tab busy; end what is left once, then wait again.
        if (swept || !sweep) return WINDOW_NOTES.busy;
        swept = true;
        await sweep();
        deadline = Date.now() + waits.busyLimitMs;
      }
      await sleep(waits.pollMs);
    }
    const outcome = await withLimit(
      control.close(window),
      waits.controlLimitMs,
    );
    return outcome === CloseOutcome.OtherTabs
      ? WINDOW_NOTES.otherTabs
      : undefined;
  } catch (error) {
    // Terminal could not be driven: the conversation has ended, so the dismiss goes on.
    if (error instanceof TerminalControlError) return controlFailureNote(error);
    throw error;
  }
}
