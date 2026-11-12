import type { Ref } from "react";

export interface WentHomeButtonProps {
  /** The visible words, "Went home today" on a desktop. */
  label: string;
  /** How many employees went home today. */
  count: number;
  /** Whether the drawer it opens is open. */
  open: boolean;
  onClick: () => void;
  /** Gets focus back when the drawer closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * The button that opens today's went-home list, with its count.
 * @param props - The label, the count and whether the list is open.
 * @returns A button floating at the office's bottom-left corner.
 */
export function WentHomeButton({
  label,
  count,
  open,
  onClick,
  buttonRef,
}: WentHomeButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="went-home-button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
      // Above the details card (z-60), which is tall at the left, so it stays reachable.
      className={`absolute bottom-2 left-2 z-[65] flex min-h-[44px] items-center gap-8 border-2 px-12 text-sm ${open ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg hover:bg-btn-hover"}`}
    >
      {label}
      <span className="bg-border px-6 text-xs">{count}</span>
    </button>
  );
}
