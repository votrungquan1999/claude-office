import { MacBlock } from "@/office/offline";
import { CommandFailReason } from "@/shared/commands";
import type { OrderClickState } from "./DetailsPanel";
import { type OrderOutcomeWords, orderOutcomeText } from "./order-outcome";
import { useOrderStatus } from "./useOrderStatus";

/** The dismiss's own wording for each phase of the order. */
const DISMISS_WORDS: OrderOutcomeWords = {
  pending: "Dismissing…",
  lostContact:
    "The office lost contact. The Mac may still dismiss the employee.",
  checkMac: "The Mac took the order but has not finished it. Check the Mac.",
  failed: (reason) =>
    reason === CommandFailReason.Interrupted
      ? "Not dismissed: the Mac's agent restarted first. Try again."
      : "Not dismissed: the Mac could not do it.",
};

interface DismissControlProps {
  /** Why the employee's Mac cannot take orders; absent when it can. */
  block?: MacBlock;
  dismiss?: OrderClickState;
  onDismiss?: () => void;
}

/**
 * The Dismiss button of the details card, with the order's outcome.
 * @param props - The Mac's state and the dismiss the owner gave.
 * @returns The control.
 */
export function DismissControl({
  block,
  dismiss,
  onDismiss,
}: DismissControlProps) {
  const phase = useOrderStatus(dismiss?.orderId ?? null);
  const outcome = dismiss?.error ?? orderOutcomeText(phase, DISMISS_WORDS);
  const sending = dismiss?.sending === true || phase.phase === "pending";
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <button
        type="button"
        data-testid="dismiss-button"
        disabled={block !== undefined || sending}
        onClick={onDismiss}
        className="border-2 border-bg-dark bg-btn-bg px-3 py-3 text-center font-bold uppercase shadow-[3px_3px_0_var(--color-bg-dark)] hover:bg-btn-hover disabled:opacity-50 [@media(max-height:500px)]:py-1"
      >
        Dismiss
      </button>
      {block === MacBlock.Outdated && (
        <p data-testid="dismiss-note" className="text-xs">
          Update this Mac's agent to dismiss employees.
        </p>
      )}
      {outcome && (
        <p
          data-testid="dismiss-outcome"
          role="status"
          className="text-xs font-bold"
        >
          {outcome}
        </p>
      )}
    </div>
  );
}
