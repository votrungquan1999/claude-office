import { rgbaToHex } from "./core/assets/colorUtils";
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from "./core/assets/constants";
import type {
  AssetIndex,
  CatalogEntry,
  CharacterDirectionSprites,
} from "./core/assets/types";
import type { OfficeState } from "./engine/officeState";
import { setFloorSprites } from "./floorTiles";
import { buildDynamicCatalog } from "./layout/furnitureCatalog";
import { migrateLayoutColors } from "./layout/layoutSerializer";
import { setCharacterTemplates } from "./sprites/spriteData";
import type { OfficeLayout } from "./types";
import { setWallSprites } from "./wallTiles";

// ── PNG decode helpers (browser fallback) ───────────────────────────────────

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function getPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
}

function readSprite(
  png: DecodedPng,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): string[][] {
  const sprite: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(
        png.data,
        png.width,
        offsetX + x,
        offsetY + y,
      );
      row.push(rgbaToHex(r, g, b, a));
    }
    sprite.push(row);
  }
  return sprite;
}

async function decodePng(url: string): Promise<DecodedPng> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch PNG: ${url} (${res.status.toString()})`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Failed to create 2d canvas context for PNG decode");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

function getIndexedAssetPath(
  kind: "characters" | "floors" | "walls",
  relPath: string,
): string {
  return relPath.startsWith(`${kind}/`) ? relPath : `${kind}/${relPath}`;
}

async function decodeCharactersFromPng(
  base: string,
  index: AssetIndex,
): Promise<CharacterDirectionSprites[]> {
  const sprites: CharacterDirectionSprites[] = [];
  for (const relPath of index.characters) {
    const png = await decodePng(
      `${base}assets/${getIndexedAssetPath("characters", relPath)}`,
    );
    const byDir: CharacterDirectionSprites = { down: [], up: [], right: [] };

    for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
      const dir = CHARACTER_DIRECTIONS[dirIdx];
      const rowOffsetY = dirIdx * CHAR_FRAME_H;
      const frames: string[][][] = [];
      for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
        frames.push(
          readSprite(
            png,
            CHAR_FRAME_W,
            CHAR_FRAME_H,
            frame * CHAR_FRAME_W,
            rowOffsetY,
          ),
        );
      }
      byDir[dir] = frames;
    }

    sprites.push(byDir);
  }
  return sprites;
}

async function decodeFloorsFromPng(
  base: string,
  index: AssetIndex,
): Promise<string[][][]> {
  const floors: string[][][] = [];
  for (const relPath of index.floors) {
    const png = await decodePng(
      `${base}assets/${getIndexedAssetPath("floors", relPath)}`,
    );
    floors.push(readSprite(png, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE));
  }
  return floors;
}

async function decodeWallsFromPng(
  base: string,
  index: AssetIndex,
): Promise<string[][][][]> {
  const wallSets: string[][][][] = [];
  for (const relPath of index.walls) {
    const png = await decodePng(
      `${base}assets/${getIndexedAssetPath("walls", relPath)}`,
    );
    const set: string[][][] = [];
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
      set.push(readSprite(png, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, ox, oy));
    }
    wallSets.push(set);
  }
  return wallSets;
}

async function decodeFurnitureFromPng(
  base: string,
  catalog: CatalogEntry[],
): Promise<Record<string, string[][]>> {
  const sprites: Record<string, string[][]> = {};
  for (const entry of catalog) {
    const png = await decodePng(`${base}assets/${entry.furniturePath}`);
    sprites[entry.id] = readSprite(png, entry.width, entry.height);
  }
  return sprites;
}

/** One load per scene, so a remount of the view never rebuilds the layout twice. */
const loads = new WeakMap<OfficeState, Promise<void>>();

/**
 * Loads the art and the office layout into the renderer's module state and the scene, once per scene.
 * @param officeState - The scene to rebuild from the loaded layout.
 * @returns Resolves when the scene holds the layout.
 */
export function loadOfficeAssets(officeState: OfficeState): Promise<void> {
  let load = loads.get(officeState);
  if (!load) {
    load = loadAssetsInto(officeState);
    loads.set(officeState, load);
  }
  return load;
}

/**
 * Order matters: the layout goes last, or its chairs find no furniture catalog and yield no seats.
 * @param officeState - The scene to rebuild from the loaded layout.
 */
async function loadAssetsInto(officeState: OfficeState): Promise<void> {
  const base = "/";
  const [assetIndex, catalog, layout] = await Promise.all([
    fetch(`${base}assets/asset-index.json`).then(
      (r) => r.json() as Promise<AssetIndex>,
    ),
    fetch(`${base}assets/furniture-catalog.json`).then(
      (r) => r.json() as Promise<CatalogEntry[]>,
    ),
    fetch(`${base}assets/office-layout.json`).then(
      (r) => r.json() as Promise<OfficeLayout>,
    ),
  ]);
  const [characters, floorSprites, wallSets, furnitureSprites] =
    await Promise.all([
      decodeCharactersFromPng(base, assetIndex),
      decodeFloorsFromPng(base, assetIndex),
      decodeWallsFromPng(base, assetIndex),
      decodeFurnitureFromPng(base, catalog),
    ]);
  setCharacterTemplates(characters);
  setFloorSprites(floorSprites);
  setWallSprites(wallSets);
  buildDynamicCatalog({ catalog, sprites: furnitureSprites });
  officeState.rebuildFromLayout(migrateLayoutColors(layout));
}
