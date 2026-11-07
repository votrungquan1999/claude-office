import { ZOOM_MAX, ZOOM_MIN } from "./constants";
import { TILE_SIZE } from "./types";

/**
 * The zoom at which the whole office fits the canvas.
 * @param canvasWidth - Canvas width in CSS px.
 * @param canvasHeight - Canvas height in CSS px.
 * @param cols - Office width in tiles.
 * @param rows - Office height in tiles.
 * @param dpr - Device pixel ratio.
 * @returns A whole zoom level (device px per sprite px), kept within the zoom limits.
 */
export function fitZoom(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  dpr: number,
): number {
  const wide = Math.floor((canvasWidth * dpr) / (cols * TILE_SIZE));
  const tall = Math.floor((canvasHeight * dpr) / (rows * TILE_SIZE));
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, wide, tall));
}
