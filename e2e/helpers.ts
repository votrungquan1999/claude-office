import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { E2E_BASE_URL, E2E_OWNER_COOKIE_FILE } from "./constants";

/**
 * Puts the seeded owner's session cookie into the browser, so the context is signed in.
 * @param context - The Playwright browser context.
 */
export async function signInAsOwner(context: BrowserContext): Promise<void> {
  const { name, value } = JSON.parse(
    readFileSync(E2E_OWNER_COOKIE_FILE, "utf8"),
  );
  await context.addCookies([{ name, value, url: E2E_BASE_URL }]);
}
