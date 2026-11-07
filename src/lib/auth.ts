import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/db/mongo";
import { readAuthEnv } from "@/lib/env";

declare global {
  var __officeAuth: Promise<Auth> | undefined;
}

/**
 * Builds the better-auth instance for the current environment.
 * @returns The instance.
 */
async function createAuth() {
  const env = readAuthEnv();
  const db = await getDb();
  const allowedEmail = env.ALLOWED_EMAIL.toLowerCase();
  const isOwner = (email: string | undefined) =>
    email?.toLowerCase() === allowedEmail;
  return betterAuth({
    database: mongodbAdapter(db),
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    databaseHooks: {
      user: {
        create: {
          // Returning false makes better-auth report unable_to_create_user and store nothing.
          before: async (user) =>
            isOwner(user.email) && user.emailVerified === true
              ? undefined
              : false,
        },
      },
      session: {
        create: {
          // Re-checked on every sign-in so a user row from elsewhere can't get a session.
          before: async (session) => {
            const row = await db
              .collection("user")
              .findOne({ _id: new ObjectId(session.userId) });
            return isOwner(row?.email) && row?.emailVerified === true
              ? undefined
              : false;
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
  });
}

type Auth = Awaited<ReturnType<typeof createAuth>>;

/**
 * The shared better-auth instance, built on first use and kept on `globalThis` across hot reloads.
 * @returns The instance.
 */
export function getAuth(): Promise<Auth> {
  globalThis.__officeAuth ??= createAuth().catch((error) => {
    // A failed build (bad env, database down) must not stick.
    globalThis.__officeAuth = undefined;
    throw error;
  });
  return globalThis.__officeAuth;
}

/** Drops the cached instance (for tests that change the environment). */
export function resetAuth(): void {
  globalThis.__officeAuth = undefined;
}
