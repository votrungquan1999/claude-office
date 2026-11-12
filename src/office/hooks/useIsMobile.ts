import { MOBILE_MEDIA_QUERY } from "../constants";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Whether the viewport counts as a phone or a small touch tablet; follows rotation and resizing.
 * @returns True on a small or touch-sized viewport.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
