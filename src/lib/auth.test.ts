import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { getAuth } from "@/lib/auth";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";

const OWNER = "Owner@Example.com";

/** Counts the rows better-auth keeps about people. */
async function authRowCounts() {
  const db = await getDb();
  const [user, session, account] = await Promise.all(
    ["user", "session", "account"].map((name) =>
      db.collection(name).countDocuments(),
    ),
  );
  return { user, session, account };
}

describe("who can get into the office", () => {
  useTestMongo();

  useTestAuth(OWNER);
  beforeEach(async () => {
    const db = await getDb();
    await Promise.all(
      ["user", "session", "account"].map((name) =>
        db.collection(name).deleteMany({}),
      ),
    );
  });

  it("refuses any other Google account and leaves no user, session or account behind", async () => {
    // Given better-auth running with the owner's email allowed
    const { internalAdapter } = await (await getAuth()).$context;

    // When a stranger's verified Google account tries to sign up
    const created = await internalAdapter.createUser({
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger",
    });

    // Then nothing is stored
    expect(created).toBeNull();
    expect(await authRowCounts()).toEqual({ user: 0, session: 0, account: 0 });
  });

  it("accepts the owner's email in any letter case and gives them a session", async () => {
    // Given Google reports the owner's email in lower case
    const { internalAdapter } = await (await getAuth()).$context;

    // When the owner signs in
    const user = await internalAdapter.createUser({
      email: "owner@example.com",
      emailVerified: true,
      name: "Owner",
    });
    const session = user && (await internalAdapter.createSession(user.id));

    // Then the user and a session exist
    expect(user?.email).toBe("owner@example.com");
    expect(session?.token).toEqual(expect.any(String));
  });

  it("refuses the owner's email when Google has not verified it", async () => {
    // Given an account that claims the owner's email without proof
    const { internalAdapter } = await (await getAuth()).$context;

    // When it tries to sign up
    const created = await internalAdapter.createUser({
      email: OWNER,
      emailVerified: false,
      name: "Impostor",
    });

    // Then it is refused and nothing is stored
    expect(created).toBeNull();
    expect(await authRowCounts()).toEqual({ user: 0, session: 0, account: 0 });
  });

  it("refuses a session for a user row that is not the owner, even though the row already exists", async () => {
    // Given a user row written around the sign-up check, as a leftover or another tool could
    const db = await getDb();
    const { insertedId } = await db.collection("user").insertOne({
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { internalAdapter } = await (await getAuth()).$context;

    // When a session is created for that user
    const session = await internalAdapter.createSession(insertedId.toString());

    // Then it is refused and no session is stored
    expect(session).toBeNull();
    expect(await authRowCounts()).toMatchObject({ session: 0 });
  });
});
