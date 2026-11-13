import { useEffect, useRef } from "react";

/** Handlers of the open overlays, the one opened last at the end. */
const openOverlays: Array<{ current: () => void }> = [];

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  openOverlays[openOverlays.length - 1]?.current();
};

/**
 * Calls a handler when Escape is pressed anywhere on the page, so a dialog closes wherever focus is.
 * Only the overlay opened last answers, so one press never closes a layer below it.
 * @param onClose - What to do on Escape.
 * @param active - Whether the overlay is open; an overlay that is always mounted passes its open state.
 */
export function useEscape(onClose: () => void, active = true) {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!active) return;
    if (openOverlays.length === 0)
      document.addEventListener("keydown", onKeyDown);
    openOverlays.push(handler);
    return () => {
      openOverlays.splice(openOverlays.indexOf(handler), 1);
      if (openOverlays.length === 0)
        document.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}
