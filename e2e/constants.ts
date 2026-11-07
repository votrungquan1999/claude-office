/** Shared by the server wrapper and the specs, which run in different processes. */
export const E2E_PORT = 4710;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DB = "claude-office-e2e";
export const E2E_DIST_DIR = ".next-e2e";
export const E2E_OWNER_EMAIL = "owner@example.com";
export const E2E_AUTH_SECRET = "e2e-auth-secret-e2e-auth-secret";

/** Files `serve.ts` writes for the specs (gitignored). */
export const E2E_MONGO_URI_FILE = ".e2e/mongo-uri";
export const E2E_OWNER_COOKIE_FILE = ".e2e/owner-cookie";
