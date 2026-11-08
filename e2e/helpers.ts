import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import {
  E2E_BASE_URL,
  E2E_DB,
  E2E_MONGO_URI_FILE,
  E2E_OWNER_COOKIE_FILE,
} from "./constants";

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

/** Moves the mouse over the employee with this renderer id, as a desktop hover on the canvas. */
export async function hoverEmployee(page: Page, id: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const point = await screenPointOf(page, id);
        if (point?.onCanvas) await page.mouse.move(point.x, point.y);
        return (
          (await page.getByTestId("agent-overlay").count()) > 0 &&
          (await page
            .getByTestId("agent-overlay")
            .first()
            .getAttribute("data-agent-id")) === String(id)
        );
      },
      { intervals: [100, 200, 400], timeout: 15_000 },
    )
    .toBe(true);
}

/** Waits until the scene holds this many employees. */
export async function waitForEmployees(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
    )
    .toBe(count);
}

/**
 * Finds the employee whose label contains the text, by selecting each one in turn.
 * @returns The renderer id; the selection is cleared again.
 */
export async function employeeLabelled(
  page: Page,
  text: string,
): Promise<number> {
  const ids = await page.evaluate(
    () => window.__officeTestHooks?.getCharacters().map((c) => c.id) ?? [],
  );
  for (const id of ids) {
    await page.evaluate((i) => window.__officeTestHooks?.selectAgent(i), id);
    const label = page.locator(
      `[data-testid="agent-overlay"][data-agent-id="${id}"]`,
    );
    await expect(label).toHaveCount(1);
    if (((await label.textContent()) ?? "").includes(text)) {
      await page.evaluate(() => window.__officeTestHooks?.selectAgent(-1));
      return id;
    }
  }
  throw new Error(`no employee labelled "${text}"`);
}

/** A folder record as the specs seed it. */
export interface SeedFolder {
  machineId: string;
  path: string;
  companyMode?: boolean;
}

/**
 * Replaces every folder record with the given ones, company mode on unless stated.
 * @param folders - The `folders` collection of the e2e database.
 * @param records - The records to store; none clears the collection.
 */
export async function seedFolders(
  folders: Collection,
  records: SeedFolder[],
): Promise<void> {
  await folders.deleteMany({});
  if (records.length === 0) return;
  await folders.insertMany(
    records.map(({ machineId, path, companyMode }) => ({
      machineId,
      path,
      companyMode: companyMode ?? true,
      firstSeenAt: new Date(),
    })),
  );
}

/**
 * Registers hooks that make every session of one Mac a project of a single company, so a spec that is not about companies sees all its employees in the office.
 * @param machineId - The Mac whose sessions the spec seeds.
 * @param path - A folder that is an ancestor of every start folder the spec seeds.
 */
export function keepOneCompany(machineId: string, path: string): void {
  const withFolders = async (records: SeedFolder[]) => {
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    try {
      await seedFolders(client.db(E2E_DB).collection("folders"), records);
    } finally {
      await client.close();
    }
  };
  test.beforeEach(() => withFolders([{ machineId, path }]));
  test.afterEach(() => withFolders([]));
}
