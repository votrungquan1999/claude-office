import { describe, expect, it } from "vitest";
import { useTestMongo } from "@/test/use-test-mongo";
import { ensureIndexes } from "./indexes";
import { getDb } from "./mongo";

describe("the indexes of the orders collection", () => {
  useTestMongo();

  it("serves each Mac's pending-order claim and deletes an unclaimed order, message included, once its date passes", async () => {
    // Given a fresh database
    const db = await getDb();

    // When the app builds its indexes
    await ensureIndexes(db);

    // Then orders are indexed for the claim and carry the expiry that deletes them
    const indexes = await db.collection("commands").indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { machineId: 1, status: 1, createdAt: 1 },
      }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { expireAt: 1 }, expireAfterSeconds: 0 }),
    );
  });
});
