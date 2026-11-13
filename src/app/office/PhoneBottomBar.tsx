import type { Ref } from "react";
import { WentHomeButton } from "./WentHomeButton";

interface RoomsBarProps {
  /** How many employees of the viewed company went home today. */
  wentHomeCount: number;
  onWentHome: () => void;
  /** Gets focus back when the went-home sheet closes. */
  wentHomeRef: Ref<HTMLButtonElement>;
}

export interface PhoneBottomBarProps {
  /** The Rooms view's went-home button; the list view has Search instead. */
  rooms?: RoomsBarProps;
  /** Focuses the list's search field. */
  onSearch?: () => void;
  onHire: () => void;
}

/**
 * The phone's bottom bar: Search (the list) or today's went-home list (the Rooms view) on the left, Hire on the right.
 * @param props - The view's left button and the Hire handler.
 * @returns A bar that takes its own row below the list or rooms.
 */
export function PhoneBottomBar({
  rooms,
  onSearch,
  onHire,
}: PhoneBottomBarProps) {
  return (
    <div
      data-testid="phone-bottom-bar"
      className="flex shrink-0 items-center justify-between gap-8 border-t-2 border-border bg-bg px-8 pt-8"
      // The home indicator must not sit on the buttons.
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      {rooms ? (
        <WentHomeButton
          label="Went home"
          count={rooms.wentHomeCount}
          open={false}
          onClick={rooms.onWentHome}
          buttonRef={rooms.wentHomeRef}
          inFlow
        />
      ) : (
        <button
          type="button"
          onClick={onSearch}
          className="flex min-h-[44px] min-w-[44px] items-center gap-6 border-2 border-border bg-btn-bg px-12 text-sm font-bold hover:bg-btn-hover"
        >
          Search
        </button>
      )}
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
