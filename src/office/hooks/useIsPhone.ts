import { PHONE_MEDIA_QUERY } from "../constants";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Whether the screen is a real phone (touch, short side at most 500px); follows rotation and resizing.
 * @returns True on a phone; false on an iPad or any mouse window.
 */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}
