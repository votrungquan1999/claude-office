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
  // The camera glides and employees wander, so one click can land on empty floor; tap again until the selection is the target.
  const selected = () =>
    page.evaluate(() => window.__officeTestHooks?.getSelectedAgentId());
  await expect
    .poll(
      async () => {
        if ((await selected()) === id) return true;
        const point = await screenPointOf(page, id);
        if (point?.onCanvas) await page.mouse.click(point.x, point.y);
        return (await selected()) === id;
      },
      { intervals: [100, 200, 400], timeout: 15_000 },
    )
    .toBe(true);
}
