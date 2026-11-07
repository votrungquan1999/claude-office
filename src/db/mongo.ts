import { type Db, MongoClient } from "mongodb";
import { ensureIndexes } from "@/db/indexes";

interface MongoConnection {
  client: MongoClient;
  db: Db;
}

interface MongoCacheSlot {
  cache?: MongoConnection;
  connecting?: Promise<MongoConnection>;
}

declare global {
  var __officeMongo: MongoCacheSlot | undefined;
}

/**
 * The shared cache slot; on `globalThis` so one client survives warm invocations and dev hot reload.
 * @returns The slot.
 */
function slot(): MongoCacheSlot {
  globalThis.__officeMongo ??= {};
  return globalThis.__officeMongo;
}

/**
 * Opens the connection, builds the indexes once, and caches the result.
 * @returns The client and database.
 */
function connect(): Promise<MongoConnection> {
  const mongo = slot();
  if (mongo.cache) return Promise.resolve(mongo.cache);
  if (!mongo.connecting) {
    // Read lazily so `next build` works without the variable.
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(uri, {
      ...(/[?&]serverSelectionTimeoutMS=/i.test(uri)
        ? {}
        : { serverSelectionTimeoutMS: 5000 }),
    });
    const attempt: Promise<MongoConnection> = client
      .connect()
      .then(async () => {
        const db = client.db(process.env.MONGODB_DB ?? "claude-office");
        await ensureIndexes(db);
        if (mongo.connecting !== attempt) {
          throw new Error("The database connection was closed while opening.");
        }
        mongo.cache = { client, db };
        return mongo.cache;
      })
      .catch(async (error) => {
        // Clear the slot so the next call retries instead of replaying the failure.
        if (mongo.connecting === attempt) mongo.connecting = undefined;
        await client.close().catch(() => {});
        throw error;
      });
    mongo.connecting = attempt;
  }
  return mongo.connecting;
}

/**
 * Returns the shared database handle, connecting on first use.
 * @returns The database.
 */
export async function getDb(): Promise<Db> {
  return (await connect()).db;
}

/** Closes the connection and clears the cache (for tests and shutdown). */
export async function closeMongo(): Promise<void> {
  const mongo = slot();
  if (mongo.cache) {
    await mongo.cache.client.close();
    mongo.cache = undefined;
  }
  mongo.connecting = undefined;
}
