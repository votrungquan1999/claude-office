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
import type { FolderDocument } from "./folders";
import { type KeptDesks, loadSession } from "./kept";
import {
  type HireOrder,
  KNOWN_ORDER_KINDS,
  type Order,
  orderSchema,
  type WakeOrder,
} from "./orders";
import { isRunning, readProcessTable } from "./reconcile";
import { isRegistryReadable, listRegistry } from "./registry";
import {
  removeLaunchFiles,
  type TerminalOpener,
  writeHireFiles,
  writeWakeFile,
} from "./terminal-launch";
import type { SessionTracker } from "./tracker";
import { hasTranscript } from "./transcript";
import { readTrustMap, resolveTrust } from "./trust";

/** How long the Terminal opener may take; a hung `open` would otherwise block every later order. */
const OPENER_TIMEOUT_MS = 30_000;
/** After the claim the order row stays this long so its outcome can still be read. */
const CLAIMED_ORDER_TTL_MS = 86_400_000;
/** Where `claude` usually lives when the agent's own PATH is short (a login job). */
const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

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
  now: () => number;
  log: (message: string) => void;
}

export interface CommandPoller {
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
      log(
        `could not open a Terminal window: ${error instanceof Error ? error.message : String(error)}`,
      );
      return CommandFailReason.LaunchFailed;
    }
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
      log(
        `could not read the process table: ${error instanceof Error ? error.message : String(error)}`,
      );
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
        log(
          `could not open a Terminal window: ${error instanceof Error ? error.message : String(error)}`,
        );
        return CommandFailReason.LaunchFailed;
      }
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

  /** Runs a valid order of whatever kind. */
  const runOrder = (order: Order): Promise<CommandFailReason | undefined> => {
    switch (order.kind) {
      case CommandKind.Hire:
        return hire(order);
      case CommandKind.Wake:
        return wake(order);
    }
  };

  /** Runs one claimed order and records how it ended. */
  const run = async (claimed: CommandDocument): Promise<void> => {
    let reason: CommandFailReason | undefined;
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
        reason = await runOrder(order);
      }
    } catch (error) {
      log(
        `order failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      reason = CommandFailReason.LaunchFailed;
    }
    await commands.updateOne(
      { _id: claimed._id },
      {
        $set: reason
          ? { status: CommandStatus.Failed, reason }
          : { status: CommandStatus.Done },
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
    poll() {
      inFlight ??= drain().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
