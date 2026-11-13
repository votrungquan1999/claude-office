import { expect, test } from "@playwright/test";
import {
  type SeedSession,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  showRooms,
  signInAsOwner,
  withE2eDb,
} from "./helpers";

/** Two companies on one online Mac: personal (shown first) and work. */
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

const PERSONAL = "/Users/q/personal/app";
const WORK = "/Users/q/work/api";

/** Seeds the sessions of both companies, replacing every earlier one. */
async function seed(rows: SeedSession[]) {
  await withE2eDb((db) =>
    seedSessions(
      db.collection("sessions"),
      rows.map((row) => ({ machineId: "air", machineName: "Air", ...row })),
    ),
  );
}

test("the phone shows a search field, Needs you, Everyone in the owner's order with a grip on each row, and Went home folded at the bottom", async ({
  context,
  page,
}) => {
  // Given placed employees in different states, one in another company that needs the owner, and one that went home today
  await seed([
    {
      sessionId: "idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Alpha idle",
      state: "idle",
      rank: "b",
    },
    {
      sessionId: "asks",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Beta asks",
      state: "waitingForYou",
      rank: "a",
    },
    {
      sessionId: "review",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Gamma review",
      state: "review",
      rank: "c",
    },
    {
      sessionId: "busy",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Delta busy",
      state: "working",
      rank: "d",
    },
    {
      sessionId: "gone",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Echo gone",
      state: "wentHome",
      hadPrompt: true,
      endedAt: new Date(),
    },
    {
      sessionId: "other",
      cwd: WORK,
      startCwd: WORK,
      deskName: "Foxtrot other",
      state: "needsPermission",
    },
  ]);
  await signInAsOwner(context);

  // When the owner opens the office on a phone
  await page.goto("/");
  const list = page.getByTestId("phone-list");
  await expect(list).toBeVisible();

  // Then the search field is there, and Needs you lists the three that need the owner, the other company's last
  await expect(
    list.getByRole("searchbox", { name: "Search employees" }),
  ).toBeVisible();
  await expect(list.getByTestId("needs-row-name")).toHaveText([
    "Beta asks",
    "Gamma review",
    "Foxtrot other",
  ]);

  // And Everyone lists the company in the owner's order with a grip on every row and none on Needs you
  await expect(list.getByTestId("list-row-name")).toHaveText([
    "Beta asks",
    "Alpha idle",
    "Gamma review",
    "Delta busy",
  ]);
  await expect(list.getByTestId("row-grip")).toHaveCount(4);

  // And Went home is folded at the bottom of the list
  const wentHome = list.getByRole("button", { name: /Went home today/ });
  await expect(wentHome).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByTestId("went-home-list")).toHaveCount(0);
  await wentHome.click();
  await expect(list.getByTestId("went-home-list")).toContainText("Echo gone");
});

test("the bottom bar offers Search and Hire and no Went home button, and Search puts the cursor in the search field", async ({
  context,
  page,
}) => {
  // Given a company with one employee that went home today
  await seed([
    {
      sessionId: "idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Alpha idle",
    },
    {
      sessionId: "gone",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Echo gone",
      state: "wentHome",
      hadPrompt: true,
      endedAt: new Date(),
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const bar = page.getByTestId("phone-bottom-bar");
  await expect(page.getByTestId("phone-list")).toBeVisible();

  // Then the bar has Search and Hire and no Went home button
  await expect(bar.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "+ Hire" })).toBeVisible();
  await expect(bar.getByRole("button", { name: /Went home/ })).toHaveCount(0);

  // When the owner presses Search
  await bar.getByRole("button", { name: "Search" }).click();

  // Then the search field has the focus
  await expect(
    page.getByRole("searchbox", { name: "Search employees" }),
  ).toBeFocused();
});

test("tapping a row, in Everyone or in Needs you, opens the employee's details sheet over the list, and closing it brings the list and the bar back", async ({
  context,
  page,
}) => {
  // Given an idle employee and one that asks
  await seed([
    {
      sessionId: "idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Alpha idle",
    },
    {
      sessionId: "asks",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Beta asks",
      state: "waitingForYou",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const list = page.getByTestId("phone-list");
  const panel = page.getByTestId("details-panel");

  // When the owner taps the idle employee's row
  await list
    .getByTestId("list-row")
    .filter({ hasText: "Alpha idle" })
    .getByRole("button", { name: /Alpha idle/ })
    .click();

  // Then its details open and the bottom bar steps aside
  await expect(panel).toContainText("Alpha idle");
  await expect(page.getByTestId("phone-bottom-bar")).toHaveCount(0);

  // When the owner closes the sheet and taps the Needs you copy
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("phone-bottom-bar")).toBeVisible();
  await list
    .getByTestId("needs-row")
    .getByRole("button", { name: /Beta asks/ })
    .click();

  // Then the details of that employee open
  await expect(panel).toContainText("Beta asks");
});

test("the repo pill narrows Everyone but never Needs you", async ({
  context,
  page,
}) => {
  // Given two repos: an employee that asks and an idle one in api, an idle one in web
  const api = { name: "api", key: "aaaaaaaaaaaa" };
  const web = { name: "web", key: "bbbbbbbbbbbb" };
  await seed([
    {
      sessionId: "asks",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Alpha asks",
      state: "waitingForYou",
      tags: [api],
      rank: "a",
    },
    {
      sessionId: "api-idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Beta api",
      tags: [api],
      rank: "b",
    },
    {
      sessionId: "web-idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Gamma web",
      tags: [web],
      rank: "c",
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const list = page.getByTestId("phone-list");
  await expect(list.getByTestId("list-row-name")).toHaveText([
    "Alpha asks",
    "Beta api",
    "Gamma web",
  ]);

  // When the owner picks the web repo
  await page.getByTestId("tag-filter").locator("button[aria-expanded]").click();
  await page
    .getByRole("dialog", { name: "Filter by repo" })
    .getByRole("button", { name: "web 1" })
    .click();

  // Then Everyone shows only the web employee and Needs you still lists the one that asks
  await expect(list.getByTestId("list-row-name")).toHaveText(["Gamma web"]);
  await expect(list.getByTestId("needs-row-name")).toHaveText(["Alpha asks"]);
});

test("a phone that remembers the Rooms view shows the stacked rooms and the bar's Went home button instead of the list", async ({
  context,
  page,
}) => {
  // Given an employee that went home today and a phone set to Rooms
  await seed([
    {
      sessionId: "idle",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Alpha idle",
    },
    {
      sessionId: "gone",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Echo gone",
      state: "wentHome",
      hadPrompt: true,
      endedAt: new Date(),
    },
  ]);
  await signInAsOwner(context);
  await showRooms(context);

  // When the owner opens the office
  await page.goto("/");

  // Then the rooms show, there is no list, and the bar has Went home and Hire
  await expect(page.getByTestId("stacked-rooms")).toBeVisible();
  await expect(page.getByTestId("phone-list")).toHaveCount(0);
  const bar = page.getByTestId("phone-bottom-bar");
  await expect(bar.getByRole("button", { name: /Went home/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Search" })).toHaveCount(0);
});
