import { useSyncExternalStore } from "react";
import { SIDEWAYS_PHONE_QUERY } from "../constants";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(SIDEWAYS_PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is a phone held sideways; follows rotation and resizing.
 * @returns True when the viewport is landscape and short.
 */
export function useIsSidewaysPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SIDEWAYS_PHONE_QUERY).matches,
    () => false,
  );
}
