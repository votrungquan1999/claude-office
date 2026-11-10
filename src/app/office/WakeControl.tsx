import { MacBlock } from "@/office/offline";
import { CommandFailReason } from "@/shared/commands";
import type { OrderClickState } from "./DetailsPanel";
import { type OrderOutcomeWords, orderOutcomeText } from "./order-outcome";
import { useOrderStatus } from "./useOrderStatus";

const FAILURE_TEXT: Record<CommandFailReason, string> = {
  [CommandFailReason.FolderMissing]:
    "Not woken: the folder is missing on the Mac.",
  [CommandFailReason.ClaudeNotFound]:
    "Not woken: Claude Code was not found on the Mac.",
  [CommandFailReason.LaunchFailed]:
    "Not woken: the Mac could not open the window.",
  [CommandFailReason.Interrupted]:
    "Not woken: the Mac's agent restarted before the window opened.",
  [CommandFailReason.ConversationNotFound]:
    "Not woken: the conversation was not found on the Mac.",
  [CommandFailReason.OpenElsewhere]: "Not woken: open elsewhere.",
  [CommandFailReason.CannotCheckOpen]:
    "Not woken: the Mac could not check whether it is open elsewhere. Try again.",
  [CommandFailReason.InvalidOrder]:
    "Not woken: the Mac refused the order as not valid.",
};

/** The wake's own wording for each phase of the order. */
const WAKE_WORDS: OrderOutcomeWords = {
  pending: "Waking…",
  lostContact: "The office lost contact. The Mac may still open the window.",
  checkMac:
    "The Mac took the order but the window has not opened. Check the Mac.",
  failed: (reason) => FAILURE_TEXT[reason],
};

interface WakeControlProps {
  /** Why the employee's Mac cannot take orders; absent when it can. */
  block?: MacBlock;
  /** Whether Claude Code has not trusted the start folder. */
  untrusted: boolean;
  wake?: OrderClickState;
  onWake?: () => void;
}

/**
 * The Wake button of the details card, with the trust warning and the order's outcome.
 * @param props - The Mac's state, the folder's trust and the wake the owner gave.
 * @returns The control.
 */
export function WakeControl({
  block,
  untrusted,
  wake,
  onWake,
}: WakeControlProps) {
  const phase = useOrderStatus(wake?.orderId ?? null);
  const outcome = wake?.error ?? orderOutcomeText(phase, WAKE_WORDS);
  const sending = wake?.sending === true || phase.phase === "pending";
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <button
        type="button"
        data-testid="wake-button"
        disabled={block !== undefined || sending}
        onClick={onWake}
        className="border-2 border-bg-dark bg-accent px-3 py-3 text-center font-bold uppercase shadow-[3px_3px_0_var(--color-bg-dark)] hover:bg-accent-bright disabled:opacity-50 [@media(max-height:500px)]:py-1"
      >
        Wake
      </button>
      {block === MacBlock.Outdated && (
        <p data-testid="wake-note" className="text-xs">
          Update this Mac's agent to wake employees.
        </p>
      )}
      {untrusted && (
        <p data-testid="wake-trust-warning" className="text-xs">
          Claude Code has not trusted this folder yet: the employee will wait at
          the Mac for you to trust this folder.
        </p>
      )}
      {outcome && (
        <p
          data-testid="wake-outcome"
          role="status"
          className="text-xs font-bold"
        >
          {outcome}
        </p>
      )}
    </div>
  );
}
