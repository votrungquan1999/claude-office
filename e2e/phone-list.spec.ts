import { expect, type Page, test } from "@playwright/test";
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

/** Types into the phone's search field. */
async function typeSearch(page: Page, query: string) {
  await page.getByRole("searchbox", { name: "Search employees" }).fill(query);
}

test.describe("searching on the phone", () => {
  /** Employees of personal (shown) and work that hold "live trading" in different places. */
  async function seedSearchable() {
    const now = Date.now();
    await seed([
      {
        sessionId: "step",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Zed task",
        rank: "a",
        runningSteps: [
          { text: "Check live trading logs", startedAt: new Date(now) },
        ],
      },
      {
        sessionId: "name",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Live trading desk",
        rank: "b",
      },
      {
        sessionId: "request",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Beta task",
        rank: "c",
        request: "Please fix the live trading bug before Monday",
      },
      {
        sessionId: "none",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Nothing here",
        rank: "d",
      },
      {
        sessionId: "gone",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Gone live trading",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(now - 60_000),
      },
      {
        sessionId: "other",
        cwd: WORK,
        startCwd: WORK,
        deskName: "Work live trading",
      },
    ]);
  }

  test("typing narrows the list to the matches in the owner's order, says why each matched, lists the one that went home last, and hides the grips", async ({
    context,
    page,
  }) => {
    // Given employees that hold "live trading" in a step, a name and a first request, one that went home, and one in another company
    await seedSearchable();
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    await expect(list.getByTestId("list-row")).toHaveCount(4);

    // When the owner types the words
    await typeSearch(page, "live trading");

    // Then the count line says what was found and that the order is kept
    await expect(list.getByRole("status")).toHaveText(
      "4 matches · kept in your order",
    );

    // And the matches are in the owner's order, not ranked by where they matched
    const rows = list.getByTestId("list-row");
    await expect(rows.getByTestId("list-row-name")).toHaveText([
      "Zed task",
      "Live trading desk",
      "Beta task",
    ]);

    // And each says why: its latest step, its name, its first request
    await expect(rows.nth(0)).toContainText(
      "Last step: Check live trading logs",
    );
    await expect(rows.nth(1)).toContainText("Name: Live trading desk");
    await expect(rows.nth(2)).toContainText(
      "First request: Please fix the live trading bug before Monday",
    );

    // And the one that went home is listed after them with its time
    const gone = list.getByTestId("search-went-home");
    await expect(gone).toContainText("Gone live trading");
    await expect(gone).toContainText(/left \d\d:\d\d/);

    // And no grip shows while searching, and nothing from the other company
    await expect(list.getByTestId("row-grip")).toHaveCount(0);
    await expect(list).not.toContainText("Work live trading");
  });
  test("a search finds an employee the repo filter hides in Everyone", async ({
    context,
    page,
  test("typing the owner's tab name finds an employee whose name does not hold it, with a Tab name line", async ({
    context,
    page,
  }) => {
    // Given an employee named differently from its tab
    await seed([
      {
        sessionId: "p1",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Unrelated task",
        tabName: "real vn30",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    await expect(list.getByTestId("list-row")).toHaveCount(1);

    // When the owner types the tab's name
    await typeSearch(page, "vn30");

    // Then the row says it matched the tab name
    const row = list.getByTestId("list-row");
    await expect(row).toContainText("Unrelated task");
    await expect(row).toContainText("Tab name: real vn30");
  });

  }) => {
    // Given an api and a web employee, with the web repo picked
    const api = { name: "api", key: "aaaaaaaaaaaa" };
    const web = { name: "web", key: "bbbbbbbbbbbb" };
    await seed([
      {
        sessionId: "api",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Ledger api",
        tags: [api],
        rank: "a",
      },
      {
        sessionId: "web",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Ledger web",
        tags: [web],
        rank: "b",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    await page
      .getByTestId("tag-filter")
      .locator("button[aria-expanded]")
      .click();
    await page
      .getByRole("dialog", { name: "Filter by repo" })
      .getByRole("button", { name: "web 1" })
      .click();
    await expect(list.getByTestId("list-row-name")).toHaveText(["Ledger web"]);

    // When the owner searches the api employee
    await typeSearch(page, "ledger api");

    // Then it is found although the filter hides it from Everyone
    await expect(list.getByTestId("list-row-name")).toHaveText(["Ledger api"]);
  });

  test("Search all companies adds the other companies' matches in place, labelled with their company, and the offer goes away", async ({
    context,
    page,
  }) => {
    // Given matches in the viewed company and one in another
    await seedSearchable();
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    await typeSearch(page, "live trading");
    await expect(list.getByRole("status")).toHaveText(
      "4 matches · kept in your order",
    );
    await expect(list).not.toContainText("Work live trading");

    // When the owner asks to search all companies
    await list.getByRole("button", { name: "Search all companies" }).click();

    // Then the other company's match appears under its company, the count grows and the offer is gone
    const others = list.getByTestId("search-others");
    await expect(others).toContainText("In other companies");
    await expect(others).toContainText("work");
    await expect(others.getByTestId("list-row-name")).toHaveText([
      "Work live trading",
    ]);
    await expect(list.getByRole("status")).toHaveText(
      "5 matches · kept in your order",
    );
    await expect(
      list.getByRole("button", { name: "Search all companies" }),
    ).toHaveCount(0);

    // When the owner opens it
    await others
      .getByTestId("list-row")
      .getByRole("button", { name: /Work live trading/ })
      .click();

    // Then its company is shown and its card opens
    await expect(page.getByTestId("details-panel")).toContainText(
      "Work live trading",
    );
    await expect(page.locator('[data-company-name="work"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  test("a search with no match says so and still offers the other companies, the query stays while a row is opened, and clearing it restores the folds exactly", async ({
    context,
    page,
  }) => {
    // Given the list with Everyone folded
    await seedSearchable();
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    const everyone = list.getByRole("button", { name: /^Everyone/ });
    await everyone.click();
    await expect(everyone).toHaveAttribute("aria-expanded", "false");
    const field = page.getByRole("searchbox", { name: "Search employees" });

    // When the owner types words nobody holds
    await field.fill("zzzz");

    // Then it says so for this company and still offers the others
    await expect(list.getByRole("status")).toHaveText("No match in personal");
    await expect(
      list.getByRole("button", { name: "Search all companies" }),
    ).toBeVisible();

    // When the owner types a match that sits in the folded Everyone, and opens it
    await field.fill("live trading");
    await list
      .getByTestId("list-row")
      .getByRole("button", { name: /Live trading desk/ })
      .click();
    await expect(page.getByTestId("details-panel")).toContainText(
      "Live trading desk",
    );
    await page
      .getByTestId("details-panel")
      .getByRole("button", { name: "Close" })
      .click();

    // Then the same search is still there
    await expect(field).toHaveValue("live trading");
    await expect(list.getByRole("status")).toHaveText(
      "4 matches · kept in your order",
    );

    // When the owner clears the search
    await page.getByRole("button", { name: "Clear search" }).click();

    // Then the sections are back with Everyone still folded
    await expect(field).toHaveValue("");
    await expect(list.getByRole("status")).toHaveCount(0);
    await expect(everyone).toHaveAttribute("aria-expanded", "false");
    await expect(
      list.getByRole("button", { name: /^Went home today/ }),
    ).toBeVisible();
  });

  test("switching company keeps the query and asks again before searching the other companies", async ({
    context,
    page,
  }) => {
    // Given a search of all companies from personal
    await seedSearchable();
    await signInAsOwner(context);
    await page.goto("/");
    const list = page.getByTestId("phone-list");
    await typeSearch(page, "live trading");
    await list.getByRole("button", { name: "Search all companies" }).click();
    await expect(list.getByRole("status")).toHaveText(
      "5 matches · kept in your order",
    );

    // When the owner switches to work
    await page.locator('[data-company-name="work"]').click();

    // Then the query is kept for work, and the other companies are not searched until asked again
    await expect(
      page.getByRole("searchbox", { name: "Search employees" }),
    ).toHaveValue("live trading");
    await expect(list.getByRole("status")).toHaveText(
      "1 match · kept in your order",
    );
    await expect(list.getByTestId("list-row-name")).toHaveText([
      "Work live trading",
    ]);
    await expect(
      list.getByRole("button", { name: "Search all companies" }),
    ).toBeVisible();
  });
});
