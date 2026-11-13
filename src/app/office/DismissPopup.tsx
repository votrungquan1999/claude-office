import { useEscape } from "./useEscape";

interface DismissPopupProps {
  /** Name of the Mac the employee's window is open on. */
  machineName: string;
  /** Whether the Mac's agent closes the window; an older one leaves it open. */
  closesWindow: boolean;
  /** Whether a went-home entry will exist to wake it from; a conversation that never had a prompt leaves none. */
  canWake: boolean;
  /** What dismissing stops, when something is running; absent otherwise. */
  warning?: string;
  /** True while the Mac cannot take the order. */
  blocked: boolean;
  /** Sends the dismiss. */
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The pop-up that explains what Dismiss does before it is sent.
 * @param props - The Mac's name and the two answers.
 * @returns The pop-up.
 */
export function DismissPopup({
  machineName,
  warning,
  blocked,
  closesWindow,
  canWake,
  onConfirm,
  onCancel,
}: DismissPopupProps) {
  useEscape(onCancel);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-12">
      <button
        type="button"
        data-testid="dismiss-backdrop"
        aria-label="Close dismiss pop-up"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dismiss employee"
        className="relative flex max-h-full w-[420px] max-w-full flex-col gap-8 overflow-y-auto border-2 border-border bg-bg p-12 text-sm shadow-[6px_6px_0_var(--color-bg-dark)]"
      >
        <h3 className="text-xs font-bold uppercase">Dismiss employee</h3>
        <p>
          This conversation is still open in a Terminal window on {machineName}.{" "}
          {closesWindow
            ? `Dismiss ends it and closes the window; ${
                canWake
                  ? "you can wake it again later."
                  : "it will not appear in Went home."
              }`
            : "This Mac's agent is out of date, so Dismiss only takes it off your desks: your window stays open; close it at the Mac."}
        </p>
        {warning && <p className="font-bold">{warning}</p>}
        <div className="flex justify-end gap-8">
          <button
            type="button"
            // The safe choice takes focus when the pop-up opens.
            // biome-ignore lint/a11y/noAutofocus: a dialog moves focus into itself
            autoFocus
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="dismiss-confirm"
            disabled={blocked}
            onClick={onConfirm}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
