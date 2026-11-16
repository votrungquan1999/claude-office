import { useState } from "react";
import { z } from "zod";
import type { MachineDto } from "@/shared/session";
import { postOrder } from "../post-order";

/** Where a restart the owner asked for stands. */
export enum RestartPhase {
  /** The signal is on; the Mac has not reported a new start time yet. */
  Restarting = "restarting",
  /** No new start time a minute after the press. */
  NotBack = "notBack",
  /** The server refused or could not be reached. */
  Refused = "refused",
}

/** What the Macs group shows for one Mac's restart. */
export interface AgentRestartView {
  phase: RestartPhase;
  /** The refusal, for `Refused`. */
  error?: string;
}

/** The restarts the owner asked for, and the action that asks for one. */
export interface AgentRestarts {
  /** Where a Mac's restart stands; undefined when none was asked for or the new agent is up. */
  viewOf(machine: MachineDto): AgentRestartView | undefined;
  /** Asks a Mac's agent to restart. */
  restart(machine: MachineDto): Promise<void>;
}

/** A restart the owner asked for on this page. */
interface PendingRestart {
  /** The agent's start time at the press; a different one means the new agent is up. */
  fromStartedAt?: string;
  /** When the owner pressed, by the browser's clock. */
  sentAt: number;
  error?: string;
}

/** A restart takes seconds (launchd holds a new start only until 10 s after the previous one); a minute without a new start time means something is wrong. */
const RESTART_GIVE_UP_MS = 60_000;

const restartAnswerSchema = z.object({});

/**
 * The restarts the owner asked for from Settings, kept while the page is open so closing Settings does not lose them.
 * @param nowMs - The browser's current time, moving with the page's clock.
 * @returns How each Mac's restart stands, and the action that asks for one.
 */
export function useAgentRestarts(nowMs: number): AgentRestarts {
  const [pending, setPending] = useState<ReadonlyMap<string, PendingRestart>>(
    () => new Map(),
  );
  return {
    viewOf(machine) {
      const entry = pending.get(machine.machineId);
      if (!entry) return undefined;
      if (entry.error !== undefined) {
        return { phase: RestartPhase.Refused, error: entry.error };
      }
      if (machine.agentStartedAt !== entry.fromStartedAt) return undefined;
      return {
        phase:
          nowMs - entry.sentAt > RESTART_GIVE_UP_MS
            ? RestartPhase.NotBack
            : RestartPhase.Restarting,
      };
    },
    async restart(machine) {
      const entry: PendingRestart = {
        fromStartedAt: machine.agentStartedAt,
        sentAt: Date.now(),
      };
      setPending((current) => new Map(current).set(machine.machineId, entry));
      const result = await postOrder(
        "/api/office/machines/restart",
        { machineId: machine.machineId },
        restartAnswerSchema,
        {},
        "Not sent. Try again.",
      );
      if (!result.ok) {
        setPending((current) =>
          new Map(current).set(machine.machineId, {
            ...entry,
            error: result.error,
          }),
        );
      }
    },
  };
}
