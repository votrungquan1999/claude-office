import { sleep } from "./helpers";
import { isRunning, type ProcessTable, readProcessTable } from "./reconcile";

/** A process the dismiss will end, with the start time that proves a reused pid is not mistaken for it. */
export interface DoomedProcess {
  pid: number;
  started: string;
}

/** Reads the process table fresh. */
export type TableReader = () => Promise<ProcessTable>;

/** The waits an ending takes. */
export interface EndWaits {
  /** From SIGTERM to SIGKILL for the conversation. */
  termGraceMs: number;
  /** The same for each leftover child. */
  childGraceMs: number;
  /** How often a wait looks again. */
  pollMs: number;
}

/**
 * Whether a pid is one the agent may signal: never itself, never init.
 * @param pid - The candidate.
 * @returns True when signalling it cannot hurt the agent or the system.
 */
function signalable(pid: number): boolean {
  return pid > 1 && pid !== process.pid;
}

/**
 * Whether the very process is still running, judged from a fresh table read (a signal-0 probe passes for zombies).
 * @param doomed - The process.
 * @param readTable - Reads the process table.
 * @returns True while its pid still belongs to it.
 */
async function isStillRunning(
  doomed: DoomedProcess,
  readTable: TableReader,
): Promise<boolean> {
  const table = await readTable();
  return isRunning({ pid: doomed.pid, procStart: doomed.started }, table);
}

/**
 * Sends SIGTERM and, when the process outlasts the grace, SIGKILL, which cannot be ignored so nothing waits after it; never SIGINT, which makes zsh skip its exit.
 * @param doomed - The process.
 * @param graceMs - How long SIGTERM gets.
 * @param pollMs - How often to look again.
 * @param readTable - Reads the process table.
 */
async function endProcess(
  doomed: DoomedProcess,
  graceMs: number,
  pollMs: number,
  readTable: TableReader,
): Promise<void> {
  if (!signalable(doomed.pid) || !(await isStillRunning(doomed, readTable))) {
    return;
  }
  // The process may exit between the check and a signal.
  try {
    process.kill(doomed.pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!(await isStillRunning(doomed, readTable))) return;
    await sleep(pollMs);
  }
  try {
    process.kill(doomed.pid, "SIGKILL");
  } catch {
    // It exited just now.
  }
}

/**
 * Ends a conversation's process, then the children it left behind.
 * @param conversation - The conversation's process.
 * @param children - Its descendants, read before it was signalled (orphans lose the link to it).
 * @param waits - The grace periods.
 * @param readTable - Reads the process table; defaults to the real one.
 */
export async function endConversation(
  conversation: DoomedProcess,
  children: DoomedProcess[],
  waits: EndWaits,
  readTable: TableReader = readProcessTable,
): Promise<void> {
  await endProcess(conversation, waits.termGraceMs, waits.pollMs, readTable);
  // Together, so the whole ending takes one grace however many children there are.
  await Promise.all(
    children.map((child) =>
      endProcess(child, waits.childGraceMs, waits.pollMs, readTable),
    ),
  );
}

/**
 * Reads the processes below a pid with their start times.
 * @param table - A process table.
 * @param pids - The descendants' pids.
 * @returns The ones still in the table.
 */
export function doomedFrom(
  table: ProcessTable,
  pids: number[],
): DoomedProcess[] {
  return pids.flatMap((pid) => {
    const info = table.get(pid);
    return info ? [{ pid, started: info.started }] : [];
  });
}

/**
 * Whether two terminal device names are the same device, whichever way each is spelled.
 * @param a - A device as AppleScript (`/dev/ttys003`) or `ps` (`ttys003`) spells it.
 * @param b - Another.
 * @returns True for one real device; never for a process-less `??`.
 */
export function sameDevice(a: string, b: string): boolean {
  const name = (tty: string) => tty.replace(/^\/dev\//, "");
  return name(a) !== "??" && name(a) !== "" && name(a) === name(b);
}

/**
 * Whether any process, the login shell included, runs on a terminal device.
 * @param table - A fresh process table.
 * @param tty - The device.
 * @returns True when something is on it.
 */
export function anythingOnTty(table: ProcessTable, tty: string): boolean {
  return [...table.values()].some((info) => sameDevice(info.tty, tty));
}

/**
 * The processes still on a window's terminal that the dismiss may end: everything but the login shell.
 * @param table - A fresh process table.
 * @param tty - The window's device, as AppleScript (`/dev/ttys003`) or `ps` (`ttys003`) spells it.
 * @returns The processes to end; empty for a process-less device (`??`).
 */
export function strayOnTty(table: ProcessTable, tty: string): DoomedProcess[] {
  return [...table].flatMap(([pid, info]) => {
    if (!sameDevice(info.tty, tty) || !signalable(pid)) return [];
    // The login shell and `login` keep the window itself alive; the tab is closed as a whole afterwards.
    const program = info.args.split(/\s+/)[0] ?? "";
    const name = program.split("/").at(-1) ?? "";
    if (name.startsWith("-") || name === "login") return [];
    return [{ pid, started: info.started }];
  });
}

/**
 * Ends every process still on a terminal after the conversation ended.
 * @param table - A fresh process table.
 * @param tty - The window's device.
 * @param waits - The grace periods.
 * @param readTable - Reads the process table; defaults to the real one.
 */
export async function sweepTty(
  table: ProcessTable,
  tty: string,
  waits: EndWaits,
  readTable: TableReader = readProcessTable,
): Promise<void> {
  await Promise.all(
    strayOnTty(table, tty).map((stray) =>
      endProcess(stray, waits.childGraceMs, waits.pollMs, readTable),
    ),
  );
}
