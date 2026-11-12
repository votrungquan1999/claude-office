import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches; follows rotation and resizing.
 * @param query - The CSS media query.
 * @returns True while it matches; false on the server.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
