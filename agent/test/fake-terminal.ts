import { writeFileSync } from "node:fs";
import { type ProcessTable, readProcessTable } from "../reconcile";
import {
  CloseOutcome,
  type TerminalControl,
  TerminalControlError,
  TerminalFailure,
  type TerminalWindow,
} from "../terminal-control";
import type { TerminalOpener } from "../terminal-launch";
import type { FakeHome, FakeSession } from "./fake-home";
import { startTimeOf } from "./live-process";

/** One tab of a fake window: the device it runs on and the processes running in it. */
export interface FakeTab {
  tty: string;
  pids: number[];
  /** Processes Terminal counts as busy but `ps` does not place on the device. */
  unseen: number[];
}

/** A window the fake Terminal opened. */
export interface FakeWindow {
  id: number;
  tabs: FakeTab[];
  closed: boolean;
  /** The launch script the window ran; none for a window opened by hand. */
  script?: string;
}

export interface FakeTerminal {
  /** The opener the agent is given; records the script path and opens a fake window. */
  open: TerminalOpener;
  /** Every script path the agent asked to open, in order. */
  opened: string[];
  /** What the agent drives; windows are keyed by the pids put in their tabs, because stand-in processes have no terminal. */
  control: TerminalControl;
  /** Every window opened, in order. */
  windows: FakeWindow[];
  /** Ids of the windows the agent closed, in order. */
  closes: number[];
  /** Closes that were attempted while the tab still ran something; every one is a bug. */
  closedWhileBusy: number[];
  /** A window the owner opened by hand, which the agent never launched: no script, no terminal record. */
  openByHand(): FakeWindow;
  /** Puts processes in the tab of a window (the last one opened by default); `ps` then lists them on that tab's device. The first process put in a window the agent launched is the one its script recorded as claude's (the pid file). */
  attach(pids: number[], window?: FakeWindow): void;
  /** Puts processes in the tab that Terminal counts as busy but `ps` does not list on the tab's device. */
  attachUnseen(pids: number[], window?: FakeWindow): void;
  /** Adds a second tab, running nothing, to a window (the last one opened by default). */
  addTab(window?: FakeWindow): void;
  /** The real process table with each attached process on its tab's device, as `ps` prints it (`ttys900`); stand-ins otherwise have no terminal (`??`). */
  readProcessTable(): Promise<ProcessTable>;
  /** After `reads` more reads, every read of the process table fails, as when `ps` cannot be run. */
  failProcessTableAfter(reads: number): void;
  /** From now on every call to Terminal fails as timed out, as when the owner has not allowed control. */
  denyControl(): void;
  /** Does what Claude Code does once the window runs: writes its registry entry. */
  startSession(
    sessionId: string,
    session: Omit<FakeSession, "sessionId">,
  ): void;
}

/** Whether a process still exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A stand-in for the Terminal on a fake Mac.
 * @param fake - The Mac's fake home, where a started session registers itself.
 * @returns The opener and control to inject and the helpers to drive them.
 */
export function createFakeTerminal(fake: FakeHome): FakeTerminal {
  const opened: string[] = [];
  const windows: FakeWindow[] = [];
  const closes: number[] = [];
  const closedWhileBusy: number[] = [];
  let denied = false;
  let readsLeft = Number.POSITIVE_INFINITY;
  let nextWindowId = 7000;
  const recordedPid = new WeakSet<FakeWindow>();

  /** Busy is judged for the tab with the window's device, as the real control does. */
  const busy = (window: FakeWindow, tty: string) =>
    window.tabs
      .filter((tab) => tab.tty === tty)
      .some((tab) => [...tab.pids, ...tab.unseen].some(alive));
  const guard = () => {
    if (denied) throw new TerminalControlError(TerminalFailure.TimedOut);
  };
  const find = (window: TerminalWindow) =>
    windows.find(
      (candidate) => candidate.id === window.id && !candidate.closed,
    );

  const control: TerminalControl = {
    async findWindow({ pid, tty }) {
      guard();
      const window = windows.find(
        (candidate) =>
          !candidate.closed &&
          candidate.tabs.some(
            (tab) =>
              (pid !== undefined && tab.pids.includes(pid)) ||
              (tty !== "??" && tab.tty === tty),
          ),
      );
      if (!window) return undefined;
      // The device of the tab that matched, as the real control reports it.
      const matched = window.tabs.find(
        (tab) =>
          (pid !== undefined && tab.pids.includes(pid)) ||
          (tty !== "??" && tab.tty === tty),
      );
      return { id: window.id, tty: matched?.tty ?? "" };
    },
    async isBusy(window) {
      guard();
      const found = find(window);
      return found ? busy(found, window.tty) : false;
    },
    async close(window) {
      guard();
      const found = find(window);
      if (!found) return CloseOutcome.Missing;
      if (busy(found, window.tty)) {
        closedWhileBusy.push(found.id);
        throw new Error("closed a window while its tab was busy");
      }
      if (found.tabs.length > 1) return CloseOutcome.OtherTabs;
      found.closed = true;
      closes.push(found.id);
      return CloseOutcome.Closed;
    },
  };

  return {
    opened,
    windows,
    closes,
    closedWhileBusy,
    control,
    open: async (scriptPath) => {
      opened.push(scriptPath);
      const tty = `/dev/ttys${900 + windows.length}`;
      windows.push({
        id: nextWindowId++,
        tabs: [{ tty, pids: [], unseen: [] }],
        closed: false,
        script: scriptPath,
      });
      // What the launch script does first: records the device its shell runs on.
      writeFileSync(scriptPath.replace(/\.command$/, ".tty"), `${tty}\n`);
    },
    openByHand() {
      const window: FakeWindow = {
        id: nextWindowId++,
        tabs: [
          { tty: `/dev/ttys${900 + windows.length}`, pids: [], unseen: [] },
        ],
        closed: false,
      };
      windows.push(window);
      return window;
    },
    attach(pids, window = windows.at(-1)) {
      window?.tabs[0]?.pids.push(...pids);
      const pidFile = window?.script?.replace(/\.command$/, ".pid");
      const first = pids[0];
      // What the script records once claude's shell runs: its pid and start time; a later process on the device does not change it.
      if (
        window &&
        pidFile &&
        first !== undefined &&
        !recordedPid.has(window)
      ) {
        recordedPid.add(window);
        writeFileSync(pidFile, `${first} ${startTimeOf(first)}\n`);
      }
    },
    attachUnseen(pids, window = windows.at(-1)) {
      window?.tabs[0]?.unseen.push(...pids);
    },
    addTab(window = windows.at(-1)) {
      window?.tabs.push({
        tty: `/dev/ttys${950 + windows.length}`,
        pids: [],
        unseen: [],
      });
    },
    failProcessTableAfter(reads) {
      readsLeft = reads;
    },
    async readProcessTable() {
      if (readsLeft <= 0) throw new Error("ps could not be run");
      readsLeft -= 1;
      const table = await readProcessTable();
      for (const window of windows) {
        for (const tab of window.tabs) {
          for (const pid of tab.pids) {
            const info = table.get(pid);
            if (info) info.tty = tab.tty.replace(/^\/dev\//, "");
          }
        }
      }
      return table;
    },
    denyControl() {
      denied = true;
    },
    startSession(sessionId, session) {
      fake.addSession({ entrypoint: "cli", ...session, sessionId });
    },
  };
}
