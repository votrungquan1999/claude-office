import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Collection } from "mongodb";
import {
  type CommandDocument,
  CommandFailReason,
  CommandStatus,
  NOT_SENT_AFTER_MS,
} from "../src/shared/commands";
import type { FolderDocument } from "./folders";
import type { KeptDesks } from "./kept";
import { type HireOrder, KNOWN_ORDER_KINDS, orderSchema } from "./orders";
import {
  removeLaunchFiles,
  type TerminalOpener,
  writeHireFiles,
} from "./terminal-launch";
import type { SessionTracker } from "./tracker";

/** How long the Terminal opener may take; a hung `open` would otherwise block every later order. */
const OPENER_TIMEOUT_MS = 30_000;
/** After the claim the order row stays this long so its outcome can still be read. */
const CLAIMED_ORDER_TTL_MS = 86_400_000;
/** Where `claude` usually lives when the agent's own PATH is short (a login job). */
const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

export interface CommandPollerOptions {
  commands: Collection<CommandDocument>;
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
  const { commands, folders, machineId, home, tracker, kept, opener, log } =
    options;

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
    tracker.trackHired({
      sessionId: order.sessionId,
      folder: order.folder,
      launchedAt,
    });
    return undefined;
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
        reason = await hire(parsed.data);
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
