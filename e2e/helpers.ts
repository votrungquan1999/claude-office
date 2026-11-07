import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page } from "@playwright/test";
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

/** Where an employee is on screen right now, through the renderer's own zoom and pan. */
function screenPointOf(page: Page, id: number) {
  return page.evaluate((employeeId) => {
    const hooks = window.__officeTestHooks;
    const employee = hooks?.getCharacters().find((ch) => ch.id === employeeId);
    const canvas = document.querySelector('[data-testid="office-canvas"]');
    const at =
      employee && hooks?.getTileCenter(employee.tileCol, employee.tileRow);
    if (!at || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    const x = box.x + at.x;
    const y = box.y + at.y;
    return { x, y, onCanvas: document.elementFromPoint(x, y) === canvas };
  }, id);
}

/** Clicks the employee with this renderer id at its seat, as a real mouse click on the canvas. */
export async function clickEmployee(page: Page, id: number): Promise<void> {
  // The camera glides to a selected employee; click once it has stopped.
  let point = await screenPointOf(page, id);
  await expect
    .poll(async () => {
      const next = await screenPointOf(page, id);
      const still =
        Math.abs((next?.x ?? 0) - (point?.x ?? 1e9)) < 0.5 &&
        Math.abs((next?.y ?? 0) - (point?.y ?? 1e9)) < 0.5;
      point = next;
      return still;
    })
    .toBe(true);
  if (!point?.onCanvas)
    throw new Error(
      `employee ${id} is not clickable: ${JSON.stringify(point)}`,
    );
  await page.mouse.click(point.x, point.y);
}
