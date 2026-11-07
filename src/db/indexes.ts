import type { Db } from "mongodb";

/**
 * Builds every index the app needs; each behavior that needs one adds it here.
 * @param _db - The app database.
 */
export async function ensureIndexes(_db: Db): Promise<void> {}
