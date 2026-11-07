import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Tests run in `node`; component tests opt into jsdom with a top-of-file `// @vitest-environment jsdom` pragma. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "agent/**/*.test.ts"],
    // MongoMemoryReplSet.create() in beforeAll can exceed the 10 s default.
    hookTimeout: 60_000,
  },
});
