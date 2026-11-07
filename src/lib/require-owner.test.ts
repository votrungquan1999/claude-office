import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { sessionHeadersFor, signedCookie } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";

const OWNER = "owner@example.com";

describe("the owner gate every office page and API relies on", () => {
  useTestMongo();

  useTestAuth(OWNER);

  it("lets the owner's session in and turns away signed-out, forged-cookie and stranger requests", async () => {
    // Given the owner's session, plus a stranger whose rows were written behind better-auth's back
    const ownerHeaders = await sessionHeadersFor(OWNER);
    const db = await getDb();
    const userId = new ObjectId();
    await db.collection("user").insertOne({
      _id: userId,
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("session").insertOne({
      _id: new ObjectId(),
      token: "stranger-token",
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // When each kind of caller asks
    const owner = await requireOwner(ownerHeaders ?? new Headers());
    const signedOut = await requireOwner(new Headers());
    const forged = await requireOwner(
      new Headers({ cookie: "better-auth.session_token=forged.signature" }),
    );
    const stranger = await requireOwner(
      new Headers({ cookie: await signedCookie("stranger-token") }),
    );

    // Then only the owner gets through
    expect(owner).toEqual({ email: OWNER });
    expect([signedOut, forged, stranger]).toEqual([null, null, null]);
  });
});
