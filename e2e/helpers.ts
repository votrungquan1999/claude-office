import { readFileSync } from "node:fs";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { type Collection, type Db, type Document, MongoClient } from "mongodb";
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
  /** False for a folder the agent found deleted. */
  existsOnMac?: boolean;
  /** Whether Claude Code trusts the folder; left out when the Mac cannot tell. */
  cliTrusted?: boolean;
  /** The owner's name for the company. */
  displayName?: string;
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
    records.map(
      ({
        machineId,
        path,
        companyMode,
        existsOnMac,
        cliTrusted,
        displayName,
      }) => ({
        machineId,
        path,
        companyMode: companyMode ?? true,
        firstSeenAt: new Date(),
        ...(existsOnMac === undefined ? {} : { existsOnMac }),
        ...(cliTrusted === undefined ? {} : { cliTrusted }),
        ...(displayName === undefined ? {} : { displayName }),
      }),
    ),
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
  // A Mac with no record counts as offline, so the spec's Mac gets a fresh one.
  test.beforeEach(async () => {
    await withFolders([{ machineId, path }]);
    await seedOnlineMachine(machineId, "Studio Mac");
  });
  test.afterEach(async () => {
    await withFolders([]);
    await withE2eDb(async (db) => {
      await db.collection("machines").deleteMany({ machineId });
    });
  });
}

/** A session as the specs seed it; everything but the id has a default. */
export interface SeedSession {
  sessionId: string;
  machineId?: string;
  machineName?: string;
  cwd?: string;
  /** Where the session started; the company and project come from it. */
  startCwd?: string;
  state?: string;
  deskName?: string;
  /** Repo tags as the agent sends them. */
  tags?: Array<{ name: string; key: string }>;
  endedAt?: Date;
  /** Set while the owner keeps the employee at its desk. */
  kept?: "hired" | "woken";
  /** The Remote Control link of the window while it was open. */
  bridgeSessionId?: string;
  /** A kept employee whose window closed. */
  notRunning?: true;
  /** A hire stopped at the folder-trust question. */
  waitingAtMac?: true;
  /** A hire whose window is still opening. */
  starting?: true;
  stateSince?: Date;
}

/**
 * Replaces every session with the given ones.
 * @param sessions - The `sessions` collection of the e2e database.
 * @param rows - The sessions to store; fields left out get the defaults.
 */
export async function seedSessions(
  sessions: Collection,
  rows: SeedSession[],
): Promise<void> {
  await sessions.deleteMany({});
  await sessions.insertMany(
    rows.map(({ machineId, machineName, cwd, state, ...rest }) => ({
      machineId: machineId ?? "m1",
      machineName: machineName ?? "Studio Mac",
      cwd: cwd ?? "/Users/q/personal",
      state: state ?? "idle",
      startedAt: new Date(),
      changedAt: new Date(),
      ...rest,
    })),
  );
}

/**
 * Runs a callback against the e2e database with its own short-lived connection.
 * @param run - Receives the database.
 * @returns What the callback returned.
 */
export async function withE2eDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  try {
    return await run(client.db(E2E_DB));
  } finally {
    await client.close();
  }
}

/** Every order row, oldest first. */
export function readCommands(): Promise<Document[]> {
  return withE2eDb((db) =>
    db.collection("commands").find({}).sort({ createdAt: 1 }).toArray(),
  );
}

/** Empties the orders, so rows never leak between specs. */
export function clearCommands(): Promise<void> {
  return withE2eDb(async (db) => {
    await db.collection("commands").deleteMany({});
  });
}

/**
 * Edits one order row, as the Mac's agent would.
 * @param id - The order.
 * @param fields - Fields to set.
 */
export function updateCommand(
  id: unknown,
  fields: Record<string, unknown>,
): Promise<void> {
  return withE2eDb(async (db) => {
    await db
      .collection("commands")
      .updateOne({ _id: id as never }, { $set: fields });
  });
}

/**
 * Gives a Mac a fresh record, so the office counts it online; a Mac with no record counts as offline.
 * @param machineId - The Mac.
 * @param machineName - Its label.
 */
export function seedOnlineMachine(
  machineId: string,
  machineName: string,
): Promise<void> {
  return withE2eDb(async (db) => {
    await db.collection("machines").updateOne(
      { machineId },
      {
        $set: { machineName, lastSeenAt: new Date(), agentVersion: "0.3.0" },
      },
      { upsert: true },
    );
  });
}

/**
 * Whether two on-screen elements share any pixels.
 * @param a - The first element.
 * @param b - The second element.
 * @returns True when their bounding boxes intersect; false when either is not rendered.
 */
export async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  if (!boxA || !boxB) return false;
  return (
    boxA.x < boxB.x + boxB.width &&
    boxB.x < boxA.x + boxA.width &&
    boxA.y < boxB.y + boxB.height &&
    boxB.y < boxA.y + boxA.height
  );
}

/**
 * Where an element's bottom edge is on screen.
 * @param locator - The element, which must be rendered.
 * @returns Its bounding box's y plus height, in CSS pixels.
 */
export async function bottomOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("bottomOf: the element is not rendered");
  return box.y + box.height;
}

/**
 * Opens the went-home drawer when it is closed, and returns its list.
 * @param page - The office page.
 * @returns The list of today's departures.
 */
export async function openWentHome(page: Page): Promise<Locator> {
  const drawer = page.getByTestId("went-home-drawer");
  if (!(await drawer.isVisible()))
    await page.getByTestId("went-home-button").click();
  await expect(drawer).toBeVisible();
  return page.getByTestId("went-home-list");
}
