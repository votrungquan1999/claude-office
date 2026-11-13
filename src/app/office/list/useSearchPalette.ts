import { useEffect, useRef, useState } from "react";

/**
 * Whether the Cmd+K search is open, and the shortcut that opens it.
 * @param enabled - Whether the shortcut works on this screen.
 * @returns Whether the palette is open, and how to open and close it.
 */
export function useSearchPalette(enabled: boolean) {
  const [open, setOpen] = useState(false);
  // What had the focus before the palette, so closing gives it back
  const openedFrom = useRef<Element | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
        return;
      event.preventDefault();
      // Another dialog is in the way; stacking the palette over it would trap the owner
      if (document.querySelector('[aria-modal="true"]')) return;
      openedFrom.current = document.activeElement;
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
  return {
    open: enabled && open,
    openPalette: () => {
      openedFrom.current = document.activeElement;
      setOpen(true);
    },
    closePalette: () => {
      setOpen(false);
      if (openedFrom.current instanceof HTMLElement) openedFrom.current.focus();
    },
  };
}
