/**
 * Writes the two JSON indexes the browser needs to load the art: which characters, floors and walls
 * exist, and the furniture catalog read from each furniture manifest. Run by `predev`/`prebuild`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAssetIndex,
  buildFurnitureCatalog,
} from "../src/office/core/assets/build";

const assetsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/assets",
);

mkdirSync(assetsDir, { recursive: true });
writeFileSync(
  path.join(assetsDir, "asset-index.json"),
  JSON.stringify(buildAssetIndex(assetsDir)),
);
writeFileSync(
  path.join(assetsDir, "furniture-catalog.json"),
  JSON.stringify(buildFurnitureCatalog(assetsDir)),
);
