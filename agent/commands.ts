import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Collection } from "mongodb";
import {
  type CommandDocument,
  CommandFailReason,
  CommandKind,
  CommandStatus,
  NOT_SENT_AFTER_MS,
} from "../src/shared/commands";
import {
  anythingOnTty,
  type DoomedProcess,
  doomedFrom,
  endConversation,
  sameDevice,
  sweepTty,
} from "./end-conversation";
import type { FolderDocument } from "./folders";
import { errorText, sleep } from "./helpers";
import { type KeptDesks, loadSession } from "./kept";
import {
  type DismissOrder,
  type HireOrder,
  KNOWN_ORDER_KINDS,
  type Order,
  orderSchema,
  type WakeOrder,
} from "./orders";
import {
  argsFrom,
  descendantsOf,
  isRunning,
  type ProcessTable,
  readProcessTable,
} from "./reconcile";
import {
  isRegistryReadable,
  isShownEntry,
  listRegistry,
  pickEntry,
} from "./registry";
import {
  type TerminalControl,
  TerminalControlError,
  type TerminalWindow,
} from "./terminal-control";
import {
  isLaunchOf,
  readWindowRecord,
  removeLaunchFiles,
  removeWindowRecord,
  type TerminalOpener,
  writeHireFiles,
  writeWakeFile,
  writeWindowRecord,
} from "./terminal-launch";
import type { SessionTracker } from "./tracker";
import { hasTranscript } from "./transcript";
import { readTrustMap, resolveTrust } from "./trust";
import {
  type CloseNote,
  closeWhenIdle,
  controlFailureNote,
  WINDOW_NOTES,
  withLimit,
} from "./window-close";

/** How long the Terminal opener may take; a hung `open` would otherwise block every later order. */
const OPENER_TIMEOUT_MS = 30_000;
/** After the claim the order row stays this long so its outcome can still be read. */
const CLAIMED_ORDER_TTL_MS = 86_400_000;
/** Where `claude` usually lives when the agent's own PATH is short (a login job). */
const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** The process table could not be read in the middle of a dismiss. */
class ProcessListError extends Error {
  constructor() {
    super("could not read the process table");
  }
}

/**
 * How long each wait of a dismiss lasts. Defaults: the conversation gets 5 s, then every child gets 3 s together,
 * then the tab gets up to 5 s to stop being busy, a 3 s sweep of what is left, and 5 s more: 21 s plus the calls to Terminal, under 30 s,
 * so a queued hire is still claimed in time.
 */
export interface DismissWaits {
  /** From SIGTERM to SIGKILL for the conversation; nothing waits after SIGKILL. */
  termGraceMs: number;
  /** The same for the leftover children, all together, and again for the processes the sweep ends together. */
  childGraceMs: number;
  /** Longest wait for the tab to stop being busy, once before the sweep and once after. */
  busyLimitMs: number;
  /** Longest wait for one call to Terminal. */
  controlLimitMs: number;
  /** How often a wait looks again. */
  pollMs: number;
}

export interface CommandPollerOptions {
  commands: Collection<CommandDocument>;
  /** The sessions collection, read to bring a conversation back with its stored name. */
  sessions: Collection;
  /** The folders this Mac has shown the office; a hire only goes into one of them. */
  folders: Collection<FolderDocument>;
  machineId: string;
  home: string;
  tracker: SessionTracker;
  kept: KeptDesks;
  opener: TerminalOpener;
  /** How long the opener may take before the order fails; 30 s when absent. */
  openerTimeoutMs?: number;
  /** The claude binary to run; found on PATH when absent. */
  claudePath?: string;
  /** Drives Terminal windows; with none, Dismiss never closes a window. */
  terminalControl?: TerminalControl;
  /** Overrides of the dismiss waits. */
  dismissWaits?: Partial<DismissWaits>;
  /** Reads the process table; `ps` when absent. Tests pass a reader that gives stand-in processes a terminal device. */
  processTable?: () => Promise<ProcessTable>;
  /** How long after opening a window the agent keeps looking for its terminal device; 10 s when absent. */
  windowRecordMs?: number;
  /** Checks the tracked sessions against the registry and process table now. */
  reconcile?: () => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

/** How an order ended: failed for a reason, or done, possibly with a note for the owner. */
/** What the launch script and the agent recorded about a conversation's window. */
type WindowRecord = ReturnType<typeof readWindowRecord>;

/** How looking for a conversation's window ended. */
type WindowLookup =
  | { kind: "found"; window: TerminalWindow }
  | { kind: "missing"; note: CloseNote }
  | { kind: "blocked"; note: CloseNote };

interface OrderResult {
  reason?: CommandFailReason;
  note?: string;
}

export interface CommandPoller {
  /** Resolves once the window lookups started by earlier hires and wakes have finished; the order itself never waits for them. */
  idle(): Promise<void>;
  /** Claims and runs this Mac's waiting orders, one at a time, until none is left; a poll made meanwhile joins the running one. */
  poll(): Promise<void>;
}

/**
 * Finds the claude binary a window should run.
 * @param home - The user's home folder.
 * @returns An executable path, or undefined when claude is not installed where the agent can see.
 */
function findClaude(home: string): string | undefined {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    ...FALLBACK_BIN_DIRS,
    join(home, ".local", "bin"),
  ];
  for (const dir of dirs) {
    const candidate = join(dir, "claude");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}

/**
 * Marks every order this Mac's previous agent claimed and never finished as failed; none is retried.
 * @param commands - The orders collection.
 * @param machineId - This Mac.
 */
export async function failInterrupted(
  commands: Collection<CommandDocument>,
  machineId: string,
): Promise<void> {
  await commands.updateMany(
    { machineId, status: CommandStatus.Claimed },
    {
      $set: {
        status: CommandStatus.Failed,
        reason: CommandFailReason.Interrupted,
      },
    },
  );
}

/**
 * Runs the orders the web gives this Mac.
 * @param options - Where orders live and the Mac-side effects they use.
 * @returns A handle to poll on demand.
 */
export function createCommandPoller(
  options: CommandPollerOptions,
): CommandPoller {
  const {
    commands,
    sessions,
    folders,
    machineId,
    home,
    tracker,
    kept,
    opener,
    log,
  } = options;

  /** Runs the opener, giving up (so the order fails) when it takes too long. */
  const open = async (script: string): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    const limit = options.openerTimeoutMs ?? OPENER_TIMEOUT_MS;
    try {
      await Promise.race([
        opener(script),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`the Terminal opener took over ${limit} ms`)),
            limit,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** Claims the oldest fresh order of this Mac; the database clock decides what is fresh. */
  const claim = () =>
    commands.findOneAndUpdate(
      {
        machineId,
        // Only kinds this agent knows; any other stays for an agent that does.
        kind: { $in: KNOWN_ORDER_KINDS },
        status: CommandStatus.Pending,
        $expr: {
          $gte: ["$createdAt", { $subtract: ["$$NOW", NOT_SENT_AFTER_MS] }],
        },
      },
      [
        {
          $set: {
            status: CommandStatus.Claimed,
            claimedAt: "$$NOW",
            expireAt: { $add: ["$$NOW", CLAIMED_ORDER_TTL_MS] },
          },
        },
        // The message leaves the database here; the claim's "before" copy is the agent's only one.
        { $unset: "firstMessage" },
      ],
      { sort: { createdAt: 1 }, returnDocument: "before" },
    );

  const readTable = options.processTable ?? readProcessTable;

  const waits = {
    termGraceMs: 5000,
    childGraceMs: 3000,
    busyLimitMs: 5000,
    controlLimitMs: 5000,
    pollMs: 100,
    ...options.dismissWaits,
  };

  /** Window lookups still running after their order was done. */
  const lookups = new Set<Promise<void>>();

  /** Finds the window a launch script opened, by the terminal device the script recorded, and stores its id; a miss only costs a later Dismiss the window lookup. */
  const recordWindow = (launchId: string): void => {
    const control = options.terminalControl;
    if (!control) return;
    const lookup = (async () => {
      const deadline = Date.now() + (options.windowRecordMs ?? 10_000);
      // The script writes the device a moment after the window opens.
      let tty = readWindowRecord(home, launchId).tty;
      while (!tty) {
        if (Date.now() >= deadline) return;
        await sleep(waits.pollMs);
        tty = readWindowRecord(home, launchId).tty;
      }
      try {
        const window = await withLimit(
          control.findWindow({ tty }),
          waits.controlLimitMs,
        );
        if (window) writeWindowRecord(home, launchId, window.id);
      } catch (error) {
        if (!(error instanceof TerminalControlError)) throw error;
      }
    })()
      .catch((error: unknown) =>
        log(`could not record the window: ${errorText(error)}`),
      )
      .finally(() => lookups.delete(lookup));
    lookups.add(lookup);
  };

  /** Opens the hire's window; returns the reason it could not. */
  const hire = async (
    order: HireOrder,
  ): Promise<CommandFailReason | undefined> => {
    // A hire goes only where this Mac has shown the office a folder.
    const listed = await folders.findOne({
      machineId,
      path: order.folder,
    });
    if (!listed) return CommandFailReason.InvalidOrder;
    if (!existsSync(order.folder)) return CommandFailReason.FolderMissing;
    const claudePath = options.claudePath ?? findClaude(home);
    if (!claudePath || !existsSync(claudePath)) {
      return CommandFailReason.ClaudeNotFound;
    }
    const script = writeHireFiles({
      home,
      sessionId: order.sessionId,
      folder: order.folder,
      claudePath,
      message: order.firstMessage,
    });
    try {
      await open(script);
    } catch (error) {
      removeLaunchFiles(home, order.sessionId);
      log(`could not open a Terminal window: ${errorText(error)}`);
      return CommandFailReason.LaunchFailed;
    }
    recordWindow(order.sessionId);
    const launchedAt = options.now();
    kept.add({
      sessionId: order.sessionId,
      launchId: order.sessionId,
      folder: order.folder,
      kind: "hired",
      launchedAt,
      filesPresent: true,
    });
    const trust = readTrustMap(home);
    tracker.trackHired({
      sessionId: order.sessionId,
      folder: order.folder,
      launchedAt,
      message: order.firstMessage,
      trusted: trust ? resolveTrust(order.folder, trust) : undefined,
    });
    return undefined;
  };

  /** Sessions whose wake is between the first check and the window opening. */
  const waking = new Set<string>();

  /** Why the session counts as open (or unknowable), or undefined when no live process has its id. */
  const openElsewhere = async (
    sessionId: string,
  ): Promise<CommandFailReason | undefined> => {
    let table: Awaited<ReturnType<typeof readProcessTable>>;
    try {
      table = await readProcessTable();
    } catch (error) {
      log(`could not read the process table: ${errorText(error)}`);
      return CommandFailReason.CannotCheckOpen;
    }
    // An unlistable registry says nothing about who is open, so the wake is not attempted.
    if (!isRegistryReadable(home)) return CommandFailReason.CannotCheckOpen;
    const open = listRegistry(home)
      .filter((entry) => entry.sessionId === sessionId)
      .some((entry) => isRunning(entry, table));
    return open ? CommandFailReason.OpenElsewhere : undefined;
  };

  /** Reopens a conversation in a new window; returns the reason it could not. */
  const wake = async (
    order: WakeOrder,
  ): Promise<CommandFailReason | undefined> => {
    const { sessionId } = order;
    // Two windows on one conversation would write the same transcript, so any doubt refuses.
    if (tracker.isLaunching(sessionId) || waking.has(sessionId)) {
      return CommandFailReason.OpenElsewhere;
    }
    // Marked before the first await, so no other order can pass this gate while this one checks.
    waking.add(sessionId);
    try {
      const blocked = await openElsewhere(sessionId);
      if (blocked) return blocked;
      // The folder is the one this Mac stored for the conversation, never one an order carries.
      const stored = await loadSession(sessions, machineId, sessionId);
      if (!stored) return CommandFailReason.ConversationNotFound;
      const folder = stored.startCwd ?? stored.cwd;
      if (!existsSync(folder)) return CommandFailReason.FolderMissing;
      if (!hasTranscript(home, sessionId)) {
        return CommandFailReason.ConversationNotFound;
      }
      const claudePath = options.claudePath ?? findClaude(home);
      if (!claudePath || !existsSync(claudePath)) {
        return CommandFailReason.ClaudeNotFound;
      }
      // Every read happens before the window opens; after it only synchronous code runs.
      const trust = readTrustMap(home);
      const script = writeWakeFile({ home, sessionId, folder, claudePath });
      try {
        await open(script);
      } catch (error) {
        removeLaunchFiles(home, sessionId);
        log(`could not open a Terminal window: ${errorText(error)}`);
        return CommandFailReason.LaunchFailed;
      }
      recordWindow(sessionId);
      const launchedAt = options.now();
      kept.add({
        sessionId,
        launchId: sessionId,
        folder,
        kind: "woken",
        launchedAt,
        filesPresent: true,
      });
      tracker.trackWoken({
        sessionId,
        folder,
        launchedAt,
        trusted: trust ? resolveTrust(folder, trust) : undefined,
        stored,
      });
      return undefined;
    } finally {
      // From here the tracker's launching mark guards the session.
      waking.delete(sessionId);
    }
  };

  /** The live process of a conversation, from the registry, with what is running below it. */
  const findConversation = async (
    sessionId: string,
  ): Promise<
    | {
        conversation: DoomedProcess;
        children: DoomedProcess[];
        tty: string;
      }
    | undefined
  > => {
    const table = await readTable();
    const live = isRegistryReadable(home)
      ? listRegistry(home, argsFrom(table)).filter(
          (entry) =>
            entry.sessionId === sessionId &&
            isShownEntry(entry) &&
            isRunning(entry, table),
        )
      : [];
    // A window still at the trust question has no registry entry; its command line names the session instead.
    const claudePath = options.claudePath ?? findClaude(home);
    const launching =
      claudePath && tracker.isLaunching(sessionId)
        ? [...table].find(([, info]) =>
            isLaunchOf(info.args, sessionId, claudePath),
          )?.[0]
        : undefined;
    const pid = pickEntry(live)?.pid ?? launching;
    const info = pid === undefined ? undefined : table.get(pid);
    if (pid === undefined || !info) return undefined;
    return {
      conversation: { pid, started: info.started },
      children: doomedFrom(table, descendantsOf(table, pid)),
      tty: info.tty,
    };
  };

  /** Finds the conversation's window; a Terminal that cannot be driven is a note, not a failure. */
  const lookUpWindow = async (
    control: TerminalControl,
    found: { conversation: DoomedProcess; tty: string },
  ): Promise<WindowLookup> => {
    try {
      const window = await withLimit(
        control.findWindow({ pid: found.conversation.pid, tty: found.tty }),
        waits.controlLimitMs,
      );
      return window
        ? { kind: "found", window }
        : { kind: "missing", note: WINDOW_NOTES.notFound };
    } catch (error) {
      if (error instanceof TerminalControlError) {
        return { kind: "blocked", note: controlFailureNote(error) };
      }
      throw error;
    }
  };

  /** Reads the process table once a dismiss has changed things: a failure then is a note on a finished dismiss, not a failed order. */
  const readTableMidDismiss = async () => {
    try {
      return await readTable();
    } catch (error) {
      log(`could not read the process table: ${errorText(error)}`);
      throw new ProcessListError();
    }
  };

  /** The last resort before a busy tab is given up on: ends what is still on its terminal, from a fresh table read. */
  const sweeper = (window: TerminalWindow) => async () =>
    sweepTty(
      await readTableMidDismiss(),
      window.tty,
      waits,
      readTableMidDismiss,
    );

  /** Ends the conversation behind a kept desk, closes its window and stops keeping the desk. */
  const dismiss = async (order: DismissOrder): Promise<OrderResult> => {
    try {
      return await endAndClose(order);
    } catch (error) {
      // The desk was already sent home; only what became of its window is unknown.
      if (error instanceof ProcessListError) {
        return { note: WINDOW_NOTES.listFailed };
      }
      throw error;
    }
  };

  /** The window of a Not running desk is still the office's to close, but only when nothing runs on its device. */
  const closeLeftoverWindow = async (
    record: WindowRecord,
    control: TerminalControl | undefined,
  ): Promise<OrderResult> => {
    // The device alone does not name a window; the owner closes it.
    if (!control || !record.tty || record.windowId === undefined) {
      return { note: WINDOW_NOTES.noWindowId };
    }
    // Only a window with nothing on its device is closed; never sweep what is there.
    if (anythingOnTty(await readTableMidDismiss(), record.tty)) {
      return { note: WINDOW_NOTES.busy };
    }
    const recorded = { id: record.windowId, tty: record.tty };
    return { note: await closeWhenIdle(control, recorded, waits) };
  };

  /** Whether the process is the very one the launch script recorded, on the device it recorded. */
  const launchedHere = (
    found: { conversation: DoomedProcess; tty: string } | undefined,
    record: WindowRecord,
  ): boolean =>
    // A hand resume can reuse the device but not the pid and start time.
    found !== undefined &&
    record.tty !== undefined &&
    sameDevice(found.tty, record.tty) &&
    record.pid === found.conversation.pid &&
    record.started === found.conversation.started;

  /** Whether the window Terminal named is the recorded one; a window id not recorded or a Terminal that cannot answer proves nothing against it. */
  const inRecordedWindow = (
    record: WindowRecord,
    looked: WindowLookup | undefined,
  ): boolean =>
    record.windowId === undefined ||
    !looked ||
    looked.kind === "blocked" ||
    (looked.kind === "found" && looked.window.id === record.windowId);

  const endAndClose = async (order: DismissOrder): Promise<OrderResult> => {
    const { sessionId } = order;
    // A second click that raced the first, or a session never kept, ends nothing.
    if (!tracker.isKept(sessionId)) return {};
    // Read before anything is signalled: a dead process has no children to list.
    const found = await findConversation(sessionId);
    const launch = kept.remove(sessionId);
    const launchId = launch?.launchId ?? sessionId;
    const record = readWindowRecord(home, launchId);
    const control = options.terminalControl;
    // Found before the process ends: a dead process has no terminal device to look the window up by.
    const looked =
      found && control && order.endRunning && launchedHere(found, record)
        ? await lookUpWindow(control, found)
        : undefined;
    const ownWindow =
      launchedHere(found, record) && inRecordedWindow(record, looked);
    // After an agent restart there is no record, and start-up already swept the launch files.
    if (launch) removeLaunchFiles(home, launch.launchId);
    removeWindowRecord(home, launchId);
    // Cleared first, so the desk goes home rather than showing "Not running" once its process is gone.
    tracker.clearKept(sessionId);
    // A page that never showed the warning pop-up may not end a running conversation.
    if (found && !order.endRunning) return { note: WINDOW_NOTES.notAsked };
    // Without proof the process runs in the office's own window, it is the owner's own.
    if (found && !ownWindow) return { note: WINDOW_NOTES.leftRunning };
    // Nothing runs behind a Not running desk, but the window it left open is still the office's to close.
    if (!found) return closeLeftoverWindow(record, control);
    await endConversation(
      found.conversation,
      found.children,
      waits,
      readTableMidDismiss,
    );
    await options.reconcile?.();
    if (looked?.kind === "found" && control) {
      return {
        note: await closeWhenIdle(
          control,
          looked.window,
          waits,
          sweeper(looked.window),
        ),
      };
    }
    return { note: looked?.kind === "found" ? undefined : looked?.note };
  };

  /** Runs a valid order of whatever kind. */
  const runOrder = async (order: Order): Promise<OrderResult> => {
    switch (order.kind) {
      case CommandKind.Hire:
        return { reason: await hire(order) };
      case CommandKind.Wake:
        return { reason: await wake(order) };
      case CommandKind.Dismiss:
        return dismiss(order);
    }
  };

  /** Runs one claimed order and records how it ended. */
  const run = async (claimed: CommandDocument): Promise<void> => {
    let reason: CommandFailReason | undefined;
    let note: string | undefined;
    try {
      // Checked right after the claim: a row that is not a well-formed order runs nothing.
      const parsed = orderSchema.safeParse(claimed);
      if (!parsed.success) {
        log(
          `order ${claimed._id} is not valid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
        );
        reason = CommandFailReason.InvalidOrder;
      } else {
        const order = parsed.data;
        ({ reason, note } = await runOrder(order));
      }
    } catch (error) {
      log(`order failed: ${errorText(error)}`);
      reason = CommandFailReason.LaunchFailed;
    }
    await commands.updateOne(
      { _id: claimed._id },
      {
        $set: reason
          ? { status: CommandStatus.Failed, reason }
          : {
              status: CommandStatus.Done,
              ...(note ? { note } : {}),
            },
      },
    );
  };

  /** Overlapping polls share one drain, so two orders never run side by side. */
  let inFlight: Promise<void> | undefined;
  const drain = async () => {
    for (let order = await claim(); order; order = await claim()) {
      await run(order);
    }
  };

  return {
    async idle() {
      await Promise.all(lookups);
    },
    poll() {
      inFlight ??= drain().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
