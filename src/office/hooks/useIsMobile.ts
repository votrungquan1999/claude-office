import { useSyncExternalStore } from "react";
import { MOBILE_MEDIA_QUERY } from "../constants";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the viewport counts as a phone or a small touch tablet; follows rotation and resizing.
 * @returns True on a small or touch-sized viewport.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    () => false,
  );
}
