import type { SpriteData } from "../types";

const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>();

// ── Outline sprite generation ─────────────────────────────────

const outlineCache = new WeakMap<SpriteData, SpriteData>();

/** Generate a 1px white outline SpriteData (2px larger in each dimension) */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineCache.get(sprite);
  if (cached) return cached;

  const rows = sprite.length;
  const cols = sprite[0].length;
  // Expanded grid: +2 in each dimension for 1px border
  const outline: string[][] = [];
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(""));
  }

  // For each opaque pixel, mark its 4 cardinal neighbors as white
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === "") continue;
      const er = r + 1;
      const ec = c + 1;
      if (outline[er - 1][ec] === "") outline[er - 1][ec] = "#FFFFFF";
      if (outline[er + 1][ec] === "") outline[er + 1][ec] = "#FFFFFF";
      if (outline[er][ec - 1] === "") outline[er][ec - 1] = "#FFFFFF";
      if (outline[er][ec + 1] === "") outline[er][ec + 1] = "#FFFFFF";
    }
  }

  // Clear pixels that overlap with original opaque pixels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== "") {
        outline[r + 1][c + 1] = "";
      }
    }
  }

  outlineCache.set(sprite, outline);
  return outline;
}

const greyCache = new WeakMap<SpriteData, SpriteData>();

/** The same sprite in greys, for an employee whose Mac is offline. */
export function getGreySprite(sprite: SpriteData): SpriteData {
  const cached = greyCache.get(sprite);
  if (cached) return cached;
  const grey = sprite.map((row) =>
    row.map((pixel) => {
      const match =
        /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(pixel);
      if (!match) return pixel;
      const [r, g, b] = [match[1], match[2], match[3]].map((hex) =>
        Number.parseInt(hex, 16),
      );
      const level = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
        .toString(16)
        .padStart(2, "0");
      return `#${level}${level}${level}${match[4] ?? ""}`;
    }),
  );
  greyCache.set(sprite, grey);
  return grey;
}

export function getCachedSprite(
  sprite: SpriteData,
  zoom: number,
): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom);
  if (!cache) {
    cache = new WeakMap();
    zoomCaches.set(zoom, cache);
  }

  const cached = cache.get(sprite);
  if (cached) return cached;

  const rows = sprite.length;
  const cols = sprite[0].length;
  const canvas = document.createElement("canvas");
  canvas.width = cols * zoom;
  canvas.height = rows * zoom;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c];
      if (color === "") continue;
      ctx.fillStyle = color;
      ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
    }
  }

  cache.set(sprite, canvas);
  return canvas;
}
