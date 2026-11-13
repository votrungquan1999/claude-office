import { useRef, useState } from "react";
import { MacBlock } from "@/office/offline";
import { CommandFailReason } from "@/shared/commands";
import type { SessionDto } from "@/shared/session";
import type { OrderClickState } from "./DetailsPanel";
import { DismissPopup } from "./DismissPopup";
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
  /** Whether the Mac's agent closes the window on Dismiss. */
  closesWindow: boolean;
  /** The employee, for the pop-up's wording. */
  session: Pick<
    SessionDto,
    | "state"
    | "machineName"
    | "waitingAtMac"
    | "starting"
    | "notRunning"
    | "hadPrompt"
  >;
}

/**
 * The extra line for an employee whose work dismissing would stop.
 * @param session - The employee.
 * @returns The warning, or undefined when nothing is running to stop.
 */
function strongWarning(session: DismissControlProps["session"]) {
  // A window at the trust question or still opening has done no work yet.
  if (session.waitingAtMac || session.starting) return undefined;
  if (session.state === "working" || session.state === "thinking")
    return "It is working right now; dismissing stops it.";
  if (session.state === "needsPermission")
    return "It is waiting for your permission; dismissing stops it.";
  return undefined;
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
  session,
  closesWindow,
}: DismissControlProps) {
  const [asking, setAsking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The pop-up closes with focus back on the button that opened it.
  const closePopup = () => {
    setAsking(false);
    buttonRef.current?.focus();
  };
  const phase = useOrderStatus(dismiss?.orderId ?? null);
  const outcome = dismiss?.error ?? orderOutcomeText(phase, DISMISS_WORDS);
  const sending = dismiss?.sending === true || phase.phase === "pending";
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <button
        ref={buttonRef}
        type="button"
        data-testid="dismiss-button"
        disabled={block !== undefined || sending}
        // A desk with no process has nothing to explain
        onClick={session.notRunning ? onDismiss : () => setAsking(true)}
        className="border-2 border-bg-dark bg-btn-bg px-3 py-3 text-center font-bold uppercase shadow-[3px_3px_0_var(--color-bg-dark)] hover:bg-btn-hover disabled:opacity-50 [@media(max-height:500px)]:py-1"
      >
        Dismiss
      </button>
      {asking && (
        <DismissPopup
          machineName={session.machineName}
          warning={strongWarning(session)}
          blocked={block !== undefined}
          closesWindow={closesWindow}
          canWake={session.hadPrompt === true}
          onConfirm={() => {
            closePopup();
            onDismiss?.();
          }}
          onCancel={closePopup}
        />
      )}
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
