import type { Db } from "mongodb";

const LAST_SEEN_EXPIRY_SECONDS = 7 * 86_400;

/**
 * Builds every index the app needs, so they all live in one place.
 * @param db - The app database.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const sessions = db.collection("sessions");
  // Unique so concurrent upserts from one Mac cannot duplicate a session.
  await sessions.createIndex({ machineId: 1, sessionId: 1 }, { unique: true });
  await sessions.createIndex({ changedAt: 1 });
  // Ended sessions carry `expireAt`; live ones expire a week after their Mac last vouched for them.
  await sessions.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  await sessions.createIndex(
    { lastSeenAt: 1 },
    { expireAfterSeconds: LAST_SEEN_EXPIRY_SECONDS },
  );
  // One record per Mac; its heartbeat updates it in place, and a retired Mac's record expires.
  const machines = db.collection("machines");
  await machines.createIndex({ machineId: 1 }, { unique: true });
  await machines.createIndex(
    { lastSeenAt: 1 },
    { expireAfterSeconds: LAST_SEEN_EXPIRY_SECONDS },
  );
  // One record per start folder per Mac; no expiry, because the owner's switches must outlive the sessions.
  await db
    .collection("folders")
    .createIndex({ machineId: 1, path: 1 }, { unique: true });
  const commands = db.collection("commands");
  // Serves each agent's "my pending orders" claim.
  await commands.createIndex({ machineId: 1, status: 1, createdAt: 1 });
  // An unclaimed order dies with its message after ten minutes; the claim moves the date out a day.
  await commands.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  const steps = db.collection("steps");
  // Serves "older steps of this session" paging, newest first.
  await steps.createIndex({
    machineId: 1,
    sessionId: 1,
    startedAt: -1,
    _id: -1,
  });
  await steps.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
  const connectCodes = db.collection("connectCodes");
  // Unique so a poll secret and a displayed code each name exactly one request.
  await connectCodes.createIndex({ secretHash: 1 }, { unique: true });
  await connectCodes.createIndex({ userCode: 1 }, { unique: true });
  // Cleanup only; routes check `expiresAt` themselves because the TTL sweep runs once a minute.
  await connectCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
