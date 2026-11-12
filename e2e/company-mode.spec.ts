import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_BASE_URL, E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  openWentHome,
  seedFolders,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

const HOUR = 3_600_000;

/** The company tab names in the strip, in order. */
const tabNames = (page: Page) =>
  page
    .getByTestId("company-tab")
    .evaluateAll((tabs) =>
      tabs.map((tab) => (tab as HTMLElement).dataset.companyName),
    );

/** A session row to seed: Mac, id, start folder, state, and the time it went home when it did. */
type SeedSession = [string, string, string, string, number?];

/** Seeds Macs air and mini, their folder records and the given sessions. */
async function seed(
  folders: Array<[string, string]>,
  sessionRows: SeedSession[],
) {
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const db = client.db(E2E_DB);
  const now = Date.now();
  const names: Record<string, string> = { air: "Air", mini: "Mini" };
  await db.collection("machines").deleteMany({});
  await db.collection("machines").insertMany(
    Object.entries(names).map(([machineId, machineName]) => ({
      machineId,
      machineName,
      lastSeenAt: new Date(now),
    })),
  );
  await seedFolders(
    db.collection("folders"),
    folders.map(([machineId, path]) => ({ machineId, path })),
  );
  const sessions = db.collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany(
    sessionRows.map(([machineId, sessionId, cwd, state, endedAgo]) => ({
      machineId,
      machineName: names[machineId],
      sessionId,
      cwd,
      startCwd: cwd,
      state,
      deskName: sessionId,
      hadPrompt: true,
      startedAt: new Date(now - 2 * HOUR),
      changedAt: new Date(now - 60_000),
      ...(endedAgo === undefined ? {} : { endedAt: new Date(now - endedAgo) }),
    })),
  );
  return {
    db,
    cleanup: async () => {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    },
  };
}

test("switching company mode off on git-repos makes its children companies for every viewer, with one request per press, and switching it on restores the grouping", async ({
  browser,
  context,
  page,
}) => {
  // Given one company, git-repos, holding two projects and a session started at git-repos itself
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/git-repos"],
      ["air", "/Users/q/git-repos/personal"],
      ["air", "/Users/q/git-repos/workspace"],
    ],
    [
      ["air", "app", "/Users/q/git-repos/personal/app", "working"],
      ["air", "tool", "/Users/q/git-repos/workspace/tool", "idle"],
      ["air", "root", "/Users/q/git-repos", "idle"],
    ],
  );
  await signInAsOwner(context);
  const modeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/office/folders/company-mode"))
      modeRequests.push(request.postData() ?? "");
  });
  const second = await browser.newContext({ baseURL: E2E_BASE_URL });
  await signInAsOwner(second);
  const otherPage = await second.newPage();

  try {
    await page.goto("/");
    await expect.poll(() => tabNames(page)).toEqual(["git-repos"]);

    // And a second browser already has the office open
    await otherPage.goto("/");
    await expect.poll(() => tabNames(otherPage)).toEqual(["git-repos"]);

    // When the owner switches git-repos off in the drawer
    await page.getByTestId("open-drawer").click();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await drawer
      .getByTestId("drawer-company-git-repos")
      .getByRole("switch")
      .click();

    // Then its children are companies, the session at git-repos itself is in Other, and one request went out
    await expect
      .poll(() => tabNames(page))
      .toEqual(["personal", "workspace", "Other"]);
    expect(modeRequests).toHaveLength(1);
    expect(JSON.parse(modeRequests[0] ?? "{}")).toEqual({
      machineId: "air",
      path: "/Users/q/git-repos",
      companyMode: false,
    });

    // And the switched-off folder stays as a dimmed row reading "in Other", the viewed company fell back to personal
    await expect(drawer.getByTestId("drawer-off-git-repos")).toContainText(
      "in Other",
    );
    await expect(
      page.locator('[data-company-name="personal"]'),
    ).toHaveAttribute("aria-current", "page");

    // And the second browser sees the same on its next poll
    await expect
      .poll(() => tabNames(otherPage), { timeout: 15_000 })
      .toEqual(["personal", "workspace", "Other"]);

    // When the owner switches it back on from the dimmed row
    await drawer
      .getByTestId("drawer-off-git-repos")
      .getByRole("switch")
      .click();

    // Then one company again, with one more request, and the other browser follows
    await expect.poll(() => tabNames(page)).toEqual(["git-repos"]);
    expect(modeRequests).toHaveLength(2);
    await expect
      .poll(() => tabNames(otherPage), { timeout: 15_000 })
      .toEqual(["git-repos"]);
  } finally {
    await second.close();
    await cleanup();
  }
});

test("a refused switch puts the tabs back and the drawer says it could not change company mode", async ({
  context,
  page,
}) => {
  // Given one company, git-repos, and a server that refuses company-mode requests
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/git-repos"],
      ["air", "/Users/q/git-repos/personal"],
    ],
    [["air", "app", "/Users/q/git-repos/personal/app", "working"]],
  );
  await signInAsOwner(context);
  await page.route("**/api/office/folders/company-mode", (route) =>
    route.fulfill({ status: 500 }),
  );

  try {
    await page.goto("/");
    await expect.poll(() => tabNames(page)).toEqual(["git-repos"]);

    // When the owner switches git-repos off
    await page.getByTestId("open-drawer").click();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await drawer
      .getByTestId("drawer-company-git-repos")
      .getByRole("switch")
      .click();

    // Then the tabs return to git-repos and the drawer shows the error
    await expect(drawer.getByRole("alert")).toHaveText(
      "Could not change company mode. Try again.",
    );
    expect(await tabNames(page)).toEqual(["git-repos"]);
  } finally {
    await cleanup();
  }
});

test("a refused switch-off of the company being viewed brings the owner back to that company", async ({
  context,
  page,
}) => {
  // Given two live companies, alpha and zeta, and a server that refuses company-mode requests
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/alpha"],
      ["air", "/Users/q/zeta"],
      ["air", "/Users/q/zeta/personal"],
    ],
    [
      ["air", "a", "/Users/q/alpha/a", "working"],
      ["air", "z", "/Users/q/zeta/personal/app", "working"],
    ],
  );
  await signInAsOwner(context);
  await page.route("**/api/office/folders/company-mode", (route) =>
    route.fulfill({ status: 500 }),
  );
  const zetaTab = page
    .getByTestId("company-tab")
    .and(page.locator('[data-company-name="zeta"]'));

  try {
    await page.goto("/");
    await expect.poll(() => tabNames(page)).toEqual(["alpha", "zeta"]);
    // And the owner is viewing zeta, not the default alpha
    await zetaTab.click();
    await expect(zetaTab).toHaveAttribute("aria-current", "page");

    // When the owner switches zeta off and the server refuses
    await page.getByTestId("open-drawer").click();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await drawer.getByTestId("drawer-company-zeta").getByRole("switch").click();
    await expect(drawer.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");

    // Then zeta is the viewed company again
    await expect(zetaTab).toHaveAttribute("aria-current", "page");
  } finally {
    await cleanup();
  }
});

test("a company stored from an earlier visit that has nothing live today is not reopened empty", async ({
  context,
  page,
}) => {
  // Given a live company (alpha), a quiet one (retired) and a browser that remembers retired
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/alpha"],
      ["air", "/Users/q/retired"],
    ],
    [["air", "a", "/Users/q/alpha/a", "working"]],
  );
  await signInAsOwner(context);
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "claude-office.company",
      "air\0/Users/q/retired",
    ),
  );

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then the live company is shown, and the quiet one gets no tab
    await expect.poll(() => tabNames(page)).toEqual(["alpha"]);
    await expect(page.getByTestId("company-tab")).toHaveAttribute(
      "aria-current",
      "page",
    );
  } finally {
    await cleanup();
  }
});

test("switching a folder off relabels an employee that is already standing in the office", async ({
  context,
  page,
}) => {
  // Given one employee in git-repos/personal/app, labelled under the company git-repos
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/git-repos"],
      ["air", "/Users/q/git-repos/personal"],
    ],
    [["air", "app", "/Users/q/git-repos/personal/app", "working"]],
  );
  await signInAsOwner(context);
  /** The label panel text of the only employee, shown by selecting it. */
  const labelText = async () => {
    const id = await page.evaluate(
      () => window.__officeTestHooks?.getCharacters()[0]?.id ?? -1,
    );
    await page.evaluate((i) => window.__officeTestHooks?.selectAgent(i), id);
    const text = await page
      .locator(`[data-testid="agent-overlay"][data-agent-id="${id}"]`)
      .textContent();
    await page.evaluate(() => window.__officeTestHooks?.selectAgent(-1));
    return text ?? "";
  };

  try {
    await page.goto("/");
    await waitForEmployees(page, 1);
    const before = await labelText();
    expect(before).toContain("personal/app");

    // When the owner switches git-repos off
    await page.getByTestId("open-drawer").click();
    await page
      .getByRole("dialog", { name: "All companies" })
      .getByTestId("drawer-company-git-repos")
      .getByRole("switch")
      .click();

    // Then the label names the new company's project at once
    await expect.poll(labelText, { timeout: 1_000 }).not.toContain("personal/");
  } finally {
    await cleanup();
  }
});

test("switching off the home folder turns the folders below it into companies", async ({
  context,
  page,
}) => {
  // Given sessions in two folders below home, grouped under one company at home
  const { cleanup } = await seed(
    [["air", "/Users/q"]],
    [
      ["air", "a", "/Users/q/git-repos/a", "working"],
      ["air", "b", "/Users/q/notes/b", "idle"],
    ],
  );
  await signInAsOwner(context);

  try {
    await page.goto("/");
    await expect.poll(() => tabNames(page)).toEqual(["q"]);

    // When the owner switches the home company off
    await page.getByTestId("open-drawer").click();
    await page
      .getByRole("dialog", { name: "All companies" })
      .getByTestId("drawer-company-q")
      .getByRole("switch")
      .click();

    // Then each folder below home is a company
    await expect.poll(() => tabNames(page)).toEqual(["git-repos", "notes"]);
  } finally {
    await cleanup();
  }
});

/** The company tab names of one Mac's group in the strip. */
const macTabs = (page: Page, machineId: string) =>
  page
    .getByTestId(`mac-group-${machineId}`)
    .getByTestId("company-tab")
    .evaluateAll((tabs) =>
      tabs.map((tab) => (tab as HTMLElement).dataset.companyName),
    );

test("sessions in a switched-off folder move to Other on that Mac only, and Other leaves when the folder is switched back on", async ({
  context,
  page,
}) => {
  // Given both Macs hold a company ws with a live session, and Air also has a session started at ws itself
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/ws"],
      ["air", "/Users/q/ws/app"],
      ["mini", "/Users/q/ws"],
      ["mini", "/Users/q/ws/app"],
    ],
    [
      ["air", "at-ws", "/Users/q/ws", "idle"],
      ["air", "in-app", "/Users/q/ws/app", "working"],
      ["mini", "m-in-app", "/Users/q/ws/app", "working"],
    ],
  );
  await signInAsOwner(context);

  try {
    await page.goto("/");
    await expect.poll(() => macTabs(page, "air")).toEqual(["ws"]);
    await expect.poll(() => macTabs(page, "mini")).toEqual(["ws"]);

    // When the owner switches ws off on Air
    await page.getByTestId("open-drawer").click();
    await page
      .getByTestId("drawer-mac-air")
      .getByTestId("drawer-company-ws")
      .getByRole("switch")
      .click();

    // Then Air's session at ws is in Other, which sorts last; Mini is untouched
    await expect.poll(() => macTabs(page, "air")).toEqual(["app", "Other"]);
    expect(await macTabs(page, "mini")).toEqual(["ws"]);
    const other = page
      .getByTestId("mac-group-air")
      .locator('[data-company-name="Other"]');
    await expect(other.getByLabel("1 idle")).toHaveText("1");

    // And Other has no switch in the drawer
    await expect(
      page
        .getByTestId("drawer-mac-air")
        .getByTestId("drawer-company-Other")
        .getByRole("switch"),
    ).toHaveCount(0);

    // When the owner switches ws back on
    await page
      .getByTestId("drawer-mac-air")
      .getByTestId("drawer-off-ws")
      .getByRole("switch")
      .click();

    // Then Other is gone
    await expect.poll(() => macTabs(page, "air")).toEqual(["ws"]);
  } finally {
    await cleanup();
  }
});

test("a session that went home today in a switched-off folder keeps Other in the strip, and the went-home list works inside it", async ({
  context,
  page,
}) => {
  // Given Air's only session at ws went home today, and a live one lives below
  const { cleanup } = await seed(
    [
      ["air", "/Users/q/ws"],
      ["air", "/Users/q/ws/app"],
    ],
    [
      ["air", "gone", "/Users/q/ws", "wentHome", 60_000],
      ["air", "in-app", "/Users/q/ws/app", "idle"],
    ],
  );
  await signInAsOwner(context);

  try {
    await page.goto("/");
    await expect.poll(() => macTabs(page, "air")).toEqual(["ws"]);

    // When ws is switched off
    await page.getByTestId("open-drawer").click();
    await page.getByTestId("drawer-company-ws").getByRole("switch").click();
    await expect.poll(() => macTabs(page, "air")).toEqual(["app", "Other"]);

    // And the owner opens Other
    await page.keyboard.press("Escape");
    await page.locator('[data-company-name="Other"]').click();

    // Then no one is at work there, and the departure is listed
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(0);
    await expect(await openWentHome(page)).toContainText("gone");
  } finally {
    await cleanup();
  }
});
