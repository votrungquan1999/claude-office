import { useMediaQuery } from "./useMediaQuery";

/**
 * Whether the main pointer is a mouse or trackpad; a finger's double-tap must not open editors.
 * @returns True with a fine pointer.
 */
export function useHasMouse(): boolean {
  return useMediaQuery("(pointer: fine)");
}
