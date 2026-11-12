import type { Ref } from "react";
import { WentHomeButton } from "./WentHomeButton";

export interface PhoneBottomBarProps {
  /** How many employees of the viewed company went home today. */
  wentHomeCount: number;
  onWentHome: () => void;
  /** Gets focus back when the went-home sheet closes. */
  wentHomeRef: Ref<HTMLButtonElement>;
  onHire: () => void;
}

/**
 * The phone's bottom bar: today's went-home list on the left, Hire on the right.
 * @param props - The went-home count and the two handlers.
 * @returns A bar that takes its own row below the rooms.
 */
export function PhoneBottomBar({
  wentHomeCount,
  onWentHome,
  wentHomeRef,
  onHire,
}: PhoneBottomBarProps) {
  return (
    <div
      data-testid="phone-bottom-bar"
      className="flex shrink-0 items-center justify-between gap-8 border-t-2 border-border bg-bg px-8 pt-8"
      // The home indicator must not sit on the buttons.
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <WentHomeButton
        label="Went home"
        count={wentHomeCount}
        open={false}
        onClick={onWentHome}
        buttonRef={wentHomeRef}
        inFlow
      />
      <button
        type="button"
        data-testid="hire-button"
        onClick={onHire}
        className="flex min-h-[44px] min-w-[44px] items-center gap-6 border-2 border-border bg-btn-bg px-12 text-sm font-bold hover:bg-btn-hover"
      >
        + Hire
      </button>
    </div>
  );
}
