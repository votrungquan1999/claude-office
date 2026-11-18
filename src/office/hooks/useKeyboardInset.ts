import { useSyncExternalStore } from "react";
import { KEYBOARD_MIN_HEIGHT_PX } from "../constants";

/**
 * How much of the screen's bottom the software keyboard covers. iOS draws the keyboard over the page without shrinking it, so only the visual viewport tells.
 * @returns The covered height in px; 0 with no keyboard, on the server, and where the browser resizes the page itself.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(
    (onChange) => {
      const viewport = window.visualViewport;
      viewport?.addEventListener("resize", onChange);
      viewport?.addEventListener("scroll", onChange);
      return () => {
        viewport?.removeEventListener("resize", onChange);
        viewport?.removeEventListener("scroll", onChange);
      };
    },
    () => {
      const viewport = window.visualViewport;
      if (!viewport) return 0;
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // A collapsing address bar or rounding is not a keyboard
      return covered >= KEYBOARD_MIN_HEIGHT_PX ? Math.round(covered) : 0;
    },
    () => 0,
  );
}
