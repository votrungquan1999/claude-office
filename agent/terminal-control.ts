import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { errorText } from "./helpers";

/** One Terminal window, named by the id AppleScript gives it and the terminal device of the conversation's tab. */
export interface TerminalWindow {
  id: number;
  /** The device of the conversation's tab, e.g. `/dev/ttys003`; the window is closed only while its tab still has it. */
  tty: string;
}

/** Why Terminal could not be driven. */
export enum TerminalFailure {
  /** The owner has not allowed (or has refused) this agent to control Terminal. */
  NotPermitted = "notPermitted",
  /** Terminal did not answer within the time limit, for example while a permission prompt is open. */
  TimedOut = "timedOut",
  /** Any other failure of the script. */
  Failed = "failed",
}

/** Terminal could not be driven; the reason is safe to show to the owner. */
export class TerminalControlError extends Error {
  constructor(readonly failure: TerminalFailure) {
    super(`Terminal could not be controlled: ${failure}`);
  }
}

/** What closing a conversation's window did. */
export enum CloseOutcome {
  Closed = "closed",
  /** The window was already gone. */
  Missing = "missing",
  /** The window holds other tabs, so it was left open. */
  OtherTabs = "otherTabs",
}

/** The part of Terminal the agent drives; the tests swap in a fake, so no test touches the real one. */
export interface TerminalControl {
  /**
   * Finds the window whose tab runs on a terminal device.
   * @param target - The terminal device (`??` when the process has none) and, when a process is known, its pid.
   * @returns The window, or undefined when Terminal is not running or no tab has the device.
   * @throws TerminalControlError when Terminal cannot be driven.
   */
  findWindow(target: {
    pid?: number;
    tty: string;
  }): Promise<TerminalWindow | undefined>;
  /**
   * Whether anything still runs in the window's tab.
   * @param window - The window.
   * @returns True while a process other than the login shell runs there.
   * @throws TerminalControlError when Terminal cannot be driven.
   */
  isBusy(window: TerminalWindow): Promise<boolean>;
  /**
   * Closes the conversation's window when its tab is the only tab; never call while it is busy, which makes Terminal ask about running processes.
   * @param window - The window.
   * @returns What happened; a window with other tabs is left open.
   * @throws TerminalControlError when Terminal cannot be driven.
   */
  close(window: TerminalWindow): Promise<CloseOutcome>;
}

/** Runs one AppleScript and returns what it printed; rejects with the failure. Injected so tests never run the real one. */
export type ScriptRunner = (script: string) => Promise<string>;

const run = promisify(execFile);

/**
 * The runner the agent uses on a Mac.
 * @param limitMs - How long one script may take; an unanswered permission prompt blocks it for about a minute.
 * @returns A runner that rejects when macOS refuses or the limit passes.
 */
export function osascriptRunner(limitMs: number): ScriptRunner {
  return async (script) => {
    const { stdout } = await run("/usr/bin/osascript", ["-e", script], {
      timeout: limitMs,
    });
    return stdout.trim();
  };
}

/**
 * Sorts a failed script into the reason the owner can act on.
 * @param error - What the runner threw.
 * @returns A Terminal control error: a refusal, a timeout, or a generic failure for anything else.
 */
function classify(error: unknown): TerminalControlError {
  const text = errorText(error);
  // -1743 is "not authorized to send Apple events".
  if (/-1743|not authori[sz]ed|not allowed/i.test(text)) {
    return new TerminalControlError(TerminalFailure.NotPermitted);
  }
  const killed = (error as { killed?: boolean } | null)?.killed === true;
  if (killed || /timed? ?out/i.test(text)) {
    return new TerminalControlError(TerminalFailure.TimedOut);
  }
  return new TerminalControlError(TerminalFailure.Failed);
}

/** The device name as AppleScript spells it. */
function deviceName(tty: string): string {
  return tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
}

/** The script text for "do this with the tab on a device"; it never starts Terminal. */
function tabScript(tty: string, body: string, otherwise = '""'): string {
  return [
    'if application "Terminal" is not running then return ""',
    'tell application "Terminal"',
    "  repeat with w in windows",
    "    repeat with t in tabs of w",
    `      if tty of t is "${deviceName(tty)}" then`,
    `        ${body}`,
    "      end if",
    "    end repeat",
    "  end repeat",
    "end tell",
    `return ${otherwise}`,
  ].join("\n");
}

/** The script text for "do this with the tab of a window id that still has the device". */
function windowTabScript(window: TerminalWindow, body: string): string {
  return [
    'if application "Terminal" is not running then return ""',
    'tell application "Terminal"',
    `  repeat with w in (windows whose id is ${window.id})`,
    "    repeat with t in tabs of w",
    `      if tty of t is "${deviceName(window.tty)}" then`,
    `        ${body}`,
    "      end if",
    "    end repeat",
    "  end repeat",
    "end tell",
    'return ""',
  ].join("\n");
}

/**
 * Terminal driven through AppleScript.
 * @param runner - Runs one script within a time limit.
 * @returns The control.
 */
export function createOsascriptControl(runner: ScriptRunner): TerminalControl {
  const runScript: ScriptRunner = async (script) => {
    try {
      return await runner(script);
    } catch (error) {
      throw classify(error);
    }
  };
  return {
    async findWindow({ tty }) {
      // A process with no terminal is in no window.
      if (tty === "??") return undefined;
      const answer = await runScript(
        tabScript(tty, 'return ((id of w) as string) & " " & (tty of t)'),
      );
      const [id, device] = answer.split(" ");
      return id && device ? { id: Number(id), tty: device } : undefined;
    },
    async isBusy(window) {
      const answer = await runScript(
        windowTabScript(window, "return (busy of t) as string"),
      );
      return answer === "true";
    },
    async close(window) {
      // Counted first: a window with other tabs is left as it is.
      const answer = await runScript(
        windowTabScript(
          window,
          'return ((count of tabs of w) as string) & " " & (tty of t)',
        ),
      );
      const [count, device] = answer.split(" ");
      // The window or its tab is gone, or the tab now belongs to another device.
      if (!count || device !== window.tty) return CloseOutcome.Missing;
      if (Number(count) !== 1) return CloseOutcome.OtherTabs;
      await runScript(windowTabScript(window, `close window id ${window.id}`));
      return CloseOutcome.Closed;
    },
  };
}
