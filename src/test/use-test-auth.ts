import { afterAll, beforeAll } from "vitest";
import { resetAuth } from "@/lib/auth";

/**
 * Points better-auth at fake Google credentials for one test file and restores it afterwards.
 * @param ownerEmail - The only email allowed in.
 */
export function useTestAuth(ownerEmail: string): void {
  beforeAll(() => {
    Object.assign(process.env, {
      BETTER_AUTH_SECRET: "test-auth-secret-test-auth-secret",
      BETTER_AUTH_URL: "http://localhost:4710",
      GOOGLE_CLIENT_ID: "fake-id",
      GOOGLE_CLIENT_SECRET: "fake-secret",
      ALLOWED_EMAIL: ownerEmail,
    });
    resetAuth();
  });
  afterAll(() => resetAuth());
}
