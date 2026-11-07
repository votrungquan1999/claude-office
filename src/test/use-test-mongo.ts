import type { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll } from "vitest";
import { closeMongo } from "@/db/mongo";
import { createReplSet } from "./create-repl-set";

/**
 * Boots an in-memory single-node replica set for the current test file and points
 * `process.env.MONGODB_URI` at it; tears down afterwards. Call once at the top of an integration `describe`.
 */
export function useTestMongo(): void {
  let server: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    server = await createReplSet();
    process.env.MONGODB_URI = server.getUri();
    process.env.MONGODB_DB = "claude-office-test";
  });

  afterAll(async () => {
    await closeMongo();
    // Undefined when the boot failed; stopping it must not hide that error.
    await server?.stop();
  });
}
