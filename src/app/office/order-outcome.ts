import type { CommandFailReason } from "@/shared/commands";
import type { OrderPhase } from "./useOrderStatus";

/** The wording one kind of order uses for the phases that differ between kinds. */
export interface OrderOutcomeWords {
  pending: string;
  lostContact: string;
  checkMac: string;
  /** What a failed order says for its reason. */
  failed: (reason: CommandFailReason) => string;
}

/**
 * The line shown for an order's phase; "not sent" reads the same for every kind.
 * @param phase - Where the order is.
 * @param words - The order kind's own wording.
 * @returns The line, or null when the order is done or none was given.
 */
export function orderOutcomeText(
  phase: OrderPhase,
  words: OrderOutcomeWords,
): string | null {
  switch (phase.phase) {
    case "pending":
      return words.pending;
    case "notSent":
      return "Not sent: the Mac did not pick it up in time. Nothing will run later.";
    case "lostContact":
      return words.lostContact;
    case "checkMac":
      return words.checkMac;
    case "failed":
      return words.failed(phase.reason);
    default:
      return null;
  }
}
