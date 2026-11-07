import { MongoMemoryReplSet } from "mongodb-memory-server";

const BOOT_ATTEMPTS = 3;

/**
 * Starts an in-memory single-node replica set. Parallel processes each pick a free port and then
 * bind it, so two can pick the same one; the loser fails with "already in use" and is started again.
 * @returns The running replica set.
 */
export async function createReplSet(): Promise<MongoMemoryReplSet> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        // The library's own 10 s launch limit is shorter than vitest's hook timeout under a busy run.
        instanceOpts: [{ launchTimeout: 60_000 }],
      });
    } catch (error) {
      const portTaken =
        error instanceof Error && error.message.includes("already in use");
      if (!portTaken || attempt === BOOT_ATTEMPTS) throw error;
    }
  }
}
