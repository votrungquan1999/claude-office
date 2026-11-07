import { readFileSync } from "node:fs";
import path from "node:path";
import { buildFurnitureCatalog } from "@/office/core/assets/build";
import { OfficeState } from "@/office/engine/officeState";
import { buildDynamicCatalog } from "@/office/layout/furnitureCatalog";
import type { OfficeLayout } from "@/office/types";

const ASSETS_DIR = path.join(process.cwd(), "public/assets");

/**
 * The generated office with the real furniture catalog loaded (blank sprites; no PNG decoding in node).
 * @returns A fresh scene.
 */
export function loadOffice(): OfficeState {
  const catalog = buildFurnitureCatalog(ASSETS_DIR);
  const sprites = Object.fromEntries(
    catalog.map((entry) => [
      entry.id,
      Array.from({ length: entry.height }, () => Array(entry.width).fill("")),
    ]),
  );
  buildDynamicCatalog({ catalog, sprites });
  const layout: OfficeLayout = JSON.parse(
    readFileSync(path.join(ASSETS_DIR, "office-layout.json"), "utf8"),
  );
  return new OfficeState(layout);
}
