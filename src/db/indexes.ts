import type { Db } from "mongodb";

/**
 * Builds every index the app needs, so they all live in one place.
 * @param db - The app database.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const sessions = db.collection("sessions");
  // Unique so concurrent upserts from one Mac cannot duplicate a session.
  await sessions.createIndex({ machineId: 1, sessionId: 1 }, { unique: true });
  await sessions.createIndex({ changedAt: 1 });
}
