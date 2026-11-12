import { useSyncExternalStore } from "react";

const MOUSE_QUERY = "(pointer: fine)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOUSE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the main pointer is a mouse or trackpad; a finger's double-tap must not open editors.
 * @returns True with a fine pointer.
 */
export function useHasMouse(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOUSE_QUERY).matches,
    () => false,
  );
}
