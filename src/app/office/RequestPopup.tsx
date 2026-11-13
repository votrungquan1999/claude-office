import { useState } from "react";
import { useEscape } from "./useEscape";

interface RequestPopupProps {
  /** The original request shown in the popup. */
  request: string;
}

/**
 * An info button that opens the original request of a session in a popup.
 * @param props - The request text.
 * @returns The button and, once opened, the popup.
 */
export function RequestPopup({ request }: RequestPopupProps) {
  const [open, setOpen] = useState(false);

  useEscape(() => setOpen(false), open);

  return (
    <>
      <button
        type="button"
        aria-label="Show the original request"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mt-2 flex size-20 shrink-0 items-center justify-center rounded-full border-2 border-border text-xs leading-none font-bold hover:bg-btn-hover"
      >
        i
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-12">
          {/* A click outside the popup lands on this layer; the keyboard closes with Escape or the × button. */}
          <button
            type="button"
            data-testid="request-backdrop"
            aria-label="Dismiss"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div
            role="dialog"
            aria-label="Original request"
            className="relative flex max-h-full w-[420px] max-w-full flex-col gap-8 border-2 border-border bg-bg p-12 text-sm shadow-[6px_6px_0_var(--color-bg-dark)]"
          >
            <div className="flex shrink-0 items-center justify-between gap-8">
              <h3 className="text-xs font-bold uppercase">Original request</h3>
              <button
                type="button"
                aria-label="Close request"
                // Focus moves into the popup when it opens.
                // biome-ignore lint/a11y/noAutofocus: a dialog moves focus into itself
                autoFocus
                onClick={() => setOpen(false)}
                className="shrink-0 px-8 text-lg leading-none hover:bg-btn-hover"
              >
                ×
              </button>
            </div>
            <p
              data-testid="request-text"
              className="min-h-0 overflow-y-auto text-base leading-snug break-words whitespace-pre-wrap"
            >
              {request}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
