import { z } from "zod";

const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.email(),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("claude-office"),
});

export interface AuthEnv {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_EMAIL: string;
  MONGODB_URI: string;
  MONGODB_DB: string;
}

/**
 * Reads and validates the auth settings; called lazily so `next build` works without them.
 * @returns The validated settings.
 */
export function readAuthEnv(): AuthEnv {
  return authEnvSchema.parse(process.env);
}
