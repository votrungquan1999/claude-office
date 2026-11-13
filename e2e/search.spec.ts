import { expect, type Page, test } from "@playwright/test";
import {
  type SeedSession,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
  withE2eDb,
} from "./helpers";

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

/** Two companies on one online Mac: personal and work. */
test.beforeEach(async () => {
  await withE2eDb(async (db) => {
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/personal" },
      { machineId: "air", path: "/Users/q/work" },
    ]);
    await db.collection("machines").deleteMany({});
  });
  await seedOnlineMachine("air", "Air");
});

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await seedFolders(db.collection("folders"), []);
    await db.collection("machines").deleteMany({});
    await db.collection("sessions").deleteMany({});
  });
});

/** Seeds the sessions of both companies, replacing every earlier one. */
async function seed(rows: SeedSession[]) {
  await withE2eDb((db) =>
    seedSessions(
      db.collection("sessions"),
      rows.map((row) => ({ machineId: "air", machineName: "Air", ...row })),
    ),
  );
}

/** Opens the palette and types a query. */
async function search(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Find an employee" }).fill(query);
}

test("Cmd+K finds an employee of any company by its name and shows the company it belongs to", async ({
  context,
  page,
}) => {
  // Given a named employee in each company
  await seed([
    {
      sessionId: "p1",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Fix the ledger export",
    },
    {
      sessionId: "w1",
      cwd: "/Users/q/work/api",
      startCwd: "/Users/q/work/api",
      deskName: "Rotate API keys",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.getByTestId("list-row")).toHaveCount(1);

  // When the owner presses Cmd+K and types a word of the name of the employee in the other company
  await search(page, "rotate");

  // Then that employee is the only match, with its company
  const matches = page.getByRole("option");
  await expect(matches).toHaveCount(1);
  await expect(matches.first()).toContainText("Rotate API keys");
  await expect(matches.first()).toContainText("work");
});

test("each match says whether it matched the name, the first request or the last step, with the matched words picked out, and the name matches come first", async ({
  context,
  page,
}) => {
  // Given one employee per field: a request, a running step and a name that all hold "leaderboard"
  const now = Date.now();
  await seed([
    {
      sessionId: "step",
      cwd: "/Users/q/work/api",
      startCwd: "/Users/q/work/api",
      deskName: "Old task",
      runningSteps: [
        { text: "Edit LeaderboardPanel.tsx", startedAt: new Date(now) },
      ],
    },
    {
      sessionId: "request",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Avatars everywhere",
      request:
        "Show the new avatar on the leaderboard rows and the profile page",
    },
    {
      sessionId: "name",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Leaderboard polish",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.getByTestId("list-row")).toHaveCount(2);

  // When the owner searches "leaderboard"
  await search(page, "leaderboard");

  // Then Name comes before First request before Last step, each labelled with the matched words picked out
  const matches = page.getByRole("option");
  await expect(matches).toHaveCount(3);
  await expect(matches.nth(0)).toContainText("Leaderboard polish");
  await expect(matches.nth(0)).toContainText("Name");
  await expect(matches.nth(1)).toContainText("Avatars everywhere");
  await expect(matches.nth(1)).toContainText(
    "First request: Show the new avatar on the leaderboard rows and the profile page",
  );
  await expect(matches.nth(1).locator("mark")).toHaveText("leaderboard");
  await expect(matches.nth(2)).toContainText("Old task");
  await expect(matches.nth(2)).toContainText(
    "Last step: Edit LeaderboardPanel.tsx",
  );
  await expect(matches.nth(2).locator("mark")).toHaveText("Leaderboard");
});

test("typing the owner's tab name finds an employee whose name does not hold it, with a Tab name line", async ({
  context,
  page,
}) => {
  // Given an employee named differently from its tab
  await seed([
    {
      sessionId: "p1",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Unrelated task",
      tabName: "real vn30",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.getByTestId("list-row")).toHaveCount(1);

  // When the owner searches the tab's name
  await search(page, "vn30");

  // Then the match says it matched the tab name, with the words picked out
  const match = page.getByRole("option");
  await expect(match).toHaveCount(1);
  await expect(match).toContainText("Unrelated task");
  await expect(match).toContainText("Tab name: real vn30");
  await expect(match.locator("mark")).toHaveText("vn30");
});

test("Cmd+K does nothing while the Hire dialog or the Rename dialog is open", async ({
  context,
  page,
}) => {
  // Given an employee whose card is open
  await seed([
    {
      sessionId: "p1",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Fix the ledger export",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const palette = page.getByRole("dialog", { name: "Find an employee" });

  // When the owner opens the Hire dialog and presses Cmd+K
  await page.getByTestId("hire-button").click();
  const hire = page.getByTestId("hire-dialog");
  await expect(hire).toBeVisible();
  await page.keyboard.press("Meta+k");

  // Then no palette opens over it
  await expect(palette).toHaveCount(0);

  // When the owner closes it, opens the Rename dialog from the card and presses Cmd+K
  await page.keyboard.press("Escape");
  await expect(hire).toHaveCount(0);
  await page.getByTestId("list-row-name").click();
  await page
    .getByTestId("details-panel")
    .getByRole("button", { name: "Rename employee" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Rename employee" }),
  ).toBeVisible();
  await page.keyboard.press("Meta+k");

  // Then no palette opens over it either
  await expect(palette).toHaveCount(0);
});

test("Up and Down choose a match and Enter shows it: the palette closes, its company is shown and its card opens", async ({
  context,
  page,
}) => {
  // Given two matches, the second in the other company than the one shown
  await seed([
    {
      sessionId: "first",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Deploy staging",
      rank: "a",
    },
    {
      sessionId: "second",
      cwd: "/Users/q/work/api",
      startCwd: "/Users/q/work/api",
      deskName: "Deploy production",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.locator('[data-company-name="personal"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await search(page, "deploy");
  const matches = page.getByRole("option");
  await expect(matches).toHaveCount(2);

  // When the owner moves down to the second match and presses Enter
  await expect(matches.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(matches.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  // Then the palette closes, the other company is shown and the employee's card is open
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toHaveCount(0);
  await expect(page.locator('[data-company-name="work"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("details-panel")).toContainText(
    "Deploy production",
  );
});

test("Cmd+Enter opens the match's Remote Control page in a new tab, and a match without Remote Control says so and opens nothing", async ({
  context,
  page,
}) => {
  // Given two matches, only one with a Remote Control id
  await seed([
    {
      sessionId: "linked",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Report linked",
      rank: "a",
      bridgeSessionId: "cse_found",
    },
    {
      sessionId: "plain",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Report plain",
      rank: "b",
    },
  ]);
  await signInAsOwner(context);
  // No real network for the Remote Control page.
  await context.route("https://claude.ai/**", (route) =>
    route.fulfill({ body: "remote control" }),
  );
  await page.goto("/");
  await search(page, "report");
  await expect(page.getByRole("option")).toHaveCount(2);

  // When the owner presses Cmd+Enter on the first match
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("Meta+Enter");

  // Then Remote Control opens in a new tab and the palette stays
  expect((await popup).url()).toBe("https://claude.ai/code/cse_found");
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toBeVisible();

  // When the owner presses Cmd+Enter on the match without one
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Meta+Enter");

  // Then the row says Remote Control is off and no further tab opens
  await expect(page.getByRole("option").nth(1)).toContainText(
    "Remote Control off",
  );
  expect(context.pages()).toHaveLength(2);
});

test("Escape closes only the palette when it is over an open drawer, and searching leaves the list in the owner's order", async ({
  context,
  page,
}) => {
  // Given a list in a set order and the companies drawer open
  await seed([
    {
      sessionId: "b",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Beta task",
      rank: "a",
    },
    {
      sessionId: "a",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Alpha task",
      rank: "b",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const names = page.getByTestId("list-row-name");
  await expect(names).toHaveText(["Beta task", "Alpha task"]);
  await page.getByRole("button", { name: "All companies" }).click();
  const drawer = page.getByRole("dialog", { name: /companies/i });
  await expect(drawer).toBeVisible();

  // When the owner searches over it and presses Escape
  await search(page, "task");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");

  // Then the palette is gone and the drawer is still open
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toHaveCount(0);
  await expect(drawer).toBeVisible();

  // And the list kept the owner's order
  await expect(names).toHaveText(["Beta task", "Alpha task"]);
});

test("the ⌘K Search button in the list opens the palette, and closing it puts the focus back on the button", async ({
  context,
  page,
}) => {
  // Given a company with one employee
  await seed([
    {
      sessionId: "a",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Alpha task",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const button = page.getByRole("button", { name: "⌘K Search" });

  // When the owner presses the button, types, and presses Escape
  await button.click();
  const field = page.getByRole("combobox", { name: "Find an employee" });
  await expect(field).toBeFocused();
  await field.fill("alpha");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Then the palette is gone and the button has the focus again
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("matches are grouped Needs you, Everyone, Went home today, each with its state, and an employee that went home opens its card", async ({
  context,
  page,
}) => {
  // Given one match each that needs the owner, is idle and went home today
  await seed([
    {
      sessionId: "idle",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Sync idle",
      state: "idle",
    },
    {
      sessionId: "gone",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Sync gone",
      state: "wentHome",
      hadPrompt: true,
      endedAt: new Date(),
    },
    {
      sessionId: "asks",
      cwd: "/Users/q/work/api",
      startCwd: "/Users/q/work/api",
      deskName: "Sync asks",
      state: "waitingForYou",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  await expect(page.getByTestId("list-row")).toHaveCount(1);

  // When the owner searches the shared word
  await search(page, "sync");

  // Then the groups come in order, each with its match and state word
  const dialog = page.getByRole("dialog", { name: "Find an employee" });
  await expect(dialog.getByRole("heading")).toHaveText([
    "Needs you",
    "Everyone",
    "Went home today",
  ]);
  const matches = page.getByRole("option");
  await expect(matches).toHaveCount(3);
  await expect(matches.nth(0)).toContainText("Sync asks");
  await expect(matches.nth(0)).toContainText("Waiting for you");
  await expect(matches.nth(1)).toContainText("Sync idle");
  await expect(matches.nth(1)).toContainText("Idle");
  await expect(matches.nth(2)).toContainText("Sync gone");
  await expect(matches.nth(2)).toContainText("Went home");

  // And the combobox names the chosen option
  const chosen = await matches.nth(0).getAttribute("id");
  await expect(
    page.getByRole("combobox", { name: "Find an employee" }),
  ).toHaveAttribute("aria-activedescendant", chosen ?? "");

  // When the owner picks the one that went home
  await matches.nth(2).click();

  // Then its card opens
  await expect(page.getByTestId("details-panel")).toContainText("Sync gone");
});

test("Enter on a match the repo filter hides clears the filter and opens its card", async ({
  context,
  page,
}) => {
  // Given an api and a web employee, with the web repo picked so the api one is hidden
  const api = { name: "api", key: "aaaaaaaaaaaa" };
  const web = { name: "web", key: "bbbbbbbbbbbb" };
  await seed([
    {
      sessionId: "api",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Ledger api",
      tags: [api],
    },
    {
      sessionId: "web",
      cwd: "/Users/q/personal/app",
      startCwd: "/Users/q/personal/app",
      deskName: "Ledger web",
      tags: [web],
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const pill = page.getByTestId("tag-filter").locator("button[aria-expanded]");
  await pill.click();
  await page
    .getByRole("dialog", { name: "Filter by repo" })
    .getByRole("button", { name: "web 1" })
    .click();
  await expect(pill).toHaveText("#web 1 of 2");
  await expect(page.getByTestId("list-row")).toHaveCount(1);

  // When the owner searches the hidden employee and presses Enter
  await search(page, "ledger api");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");

  // Then the filter is cleared and its card is open
  await expect(pill).toHaveText("All repos 2");
  await expect(page.getByTestId("list-row")).toHaveCount(2);
  await expect(page.getByTestId("details-panel")).toContainText("Ledger api");
});
