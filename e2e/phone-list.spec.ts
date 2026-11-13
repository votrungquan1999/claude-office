import { devices, expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./constants";
import {
  centerOf,
  countRankRequests,
  type SeedSession,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  showRooms,
  signInAsOwner,
  touchDrag,
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

test("a conversation that arrives after the phone's list showed gets a new dot until it is opened there", async ({
  context,
  page,
}) => {
  // Given one conversation and the phone's list already showing
  await seed([
    {
      sessionId: "old",
      cwd: PERSONAL,
      startCwd: PERSONAL,
      deskName: "Old task",
      startedAt: new Date(Date.now() - 60 * 60_000),
    },
  ]);
  await signInAsOwner(context);
  await page.goto("/");
  const names = page.getByTestId("list-row-name");
  await expect(names).toHaveText(["Old task"]);
  const dots = page.getByTestId("list-row-new");
  await expect(dots).toHaveCount(0);

  // When a new conversation starts
  await withE2eDb((db) =>
    db.collection("sessions").insertOne({
      machineId: "air",
      machineName: "Air",
      sessionId: "fresh",
      deskName: "Fresh task",
      cwd: PERSONAL,
      state: "idle",
      startedAt: new Date(),
      changedAt: new Date(),
    }),
  );

  // Then it joins the top with the only new dot
  await expect(names).toHaveText(["Fresh task", "Old task"], {
    timeout: 20_000,
  });
  await expect(dots).toHaveCount(1);

  // When the owner opens it
  await names.first().tap();

  // Then the dot is gone
  await expect(dots).toHaveCount(0);
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
    await expect(list.getByText(/kept in your order/)).toHaveCount(0);
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

test.describe("holding a row's grip", () => {
  /** Fourteen placed idle employees, so the list is taller than the screen. */
  const placed = () =>
    seed(
      Array.from({ length: 14 }, (_, i) => ({
        sessionId: `t${i}`,
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: `Task ${String(i + 1).padStart(2, "0")}`,
        state: "idle",
        rank: String.fromCharCode(98 + i),
      })),
    );
  const row = (page: Page, n: number) =>
    page.getByTestId("list-row").nth(n - 1);

  test("lifts the row, and letting go three rows down moves it there with one request that holds after a reload and on the Mac", async ({
    browser,
    context,
    page,
  }) => {
    // Given fourteen placed employees, a Mac that shows the same list, and a request counter
    await placed();
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    let answered = 0;

    page.on("response", (response) => {
      if (response.url().includes("/api/office/sessions/rank")) answered++;
    });
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);
    const scroller = page.getByTestId("phone-list-scroll");
    const scrolledBefore = await scroller.evaluate((el) => el.scrollTop);

    // When the owner holds the first row's grip, sees it lift with the gap marked, drags it three rows down and lets go
    await touchDrag(
      page,
      await centerOf(row(page, 1).getByTestId("row-grip")),
      await centerOf(row(page, 4)),
      {
        holdMs: 400,
        onHeld: async () => {
          await expect(page.getByTestId("drag-chip")).toHaveText(
            "Moving Task 01 to position 1 of 14",
          );
          await expect(page.getByText("Drops here")).toBeVisible();
        },
      },
    );

    // Then it sits fourth at once, with one request, and the list did not scroll
    await expect(names.nth(3)).toHaveText("Task 01");
    await expect(names.first()).toHaveText("Task 02");
    await expect.poll(() => answered).toBe(1);
    expect(requests.count).toBe(1);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(scrolledBefore);

    // And the order holds after a reload
    await page.reload();
    await expect(names).toHaveCount(14);
    await expect(names.nth(3)).toHaveText("Task 01");

    // And a Mac shows the same order
    const mac = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    });
    try {
      await signInAsOwner(mac);
      const macPage = await mac.newPage();
      await macPage.goto("/");
      await expect(macPage.getByTestId("list-row-name").nth(3)).toHaveText(
        "Task 01",
      );
    } finally {
      await mac.close();
    }
  });

  test("a swipe on the rest of a row scrolls the list and moves nothing", async ({
    context,
    page,
  }) => {
    // Given fourteen placed employees and a request counter
    await placed();
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);
    const scroller = page.getByTestId("phone-list-scroll");
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);

    // When the owner swipes up from the name of the second row
    const from = await centerOf(names.nth(1));
    await touchDrag(page, from, { x: from.x, y: from.y - 200 });

    // Then the list scrolled, nothing was sent and the order is the same
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect(requests.count).toBe(0);
    await expect(names.first()).toHaveText("Task 01");
    await expect(names.nth(1)).toHaveText("Task 02");
  });

  test("holding the name of a row and dragging lifts nothing and sends nothing", async ({
    context,
    page,
  }) => {
    // Given fourteen placed employees and a request counter
    await placed();
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);

    // When the owner holds the middle of a row's name for longer than the grip needs and drags to the fourth row
    await touchDrag(
      page,
      await centerOf(names.nth(1)),
      await centerOf(row(page, 4)),
      { holdMs: 400 },
    );

    // Then no row lifted, nothing was sent and the order is the same
    await expect(page.getByTestId("drag-chip")).toHaveCount(0);
    expect(requests.count).toBe(0);
    await expect(names.nth(1)).toHaveText("Task 02");
    await expect(names.nth(3)).toHaveText("Task 04");
  });

  test("a finger that moves before the hold ends lifts nothing and sends nothing", async ({
    context,
    page,
  }) => {
    // Given fourteen placed employees and a request counter
    await placed();
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);

    // When the owner puts a finger on a grip and drags it away at once
    await touchDrag(
      page,
      await centerOf(row(page, 1).getByTestId("row-grip")),
      await centerOf(row(page, 4)),
    );

    // Then no row lifted, nothing was sent and the order is the same
    await expect(page.getByTestId("drag-chip")).toHaveCount(0);
    expect(requests.count).toBe(0);
    await expect(names.first()).toHaveText("Task 01");
    await expect(names.nth(3)).toHaveText("Task 04");
  });

  test("a tap on a row opens its card, and holding the grip then letting go on the same place sends nothing", async ({
    context,
    page,
  }) => {
    // Given fourteen placed employees and a request counter
    await placed();
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);

    // When the owner holds the third row's grip, moves a little and lets go over its own place
    const grip = await centerOf(row(page, 3).getByTestId("row-grip"));
    await touchDrag(
      page,
      grip,
      { x: grip.x, y: grip.y + 6 },
      {
        holdMs: 400,
        onHeld: () =>
          expect(page.getByTestId("drag-chip")).toContainText(
            "Moving Task 03 to position 3 of 14",
          ),
      },
    );

    // Then nothing was sent and the order is the same
    await page.waitForTimeout(300);
    expect(requests.count).toBe(0);
    await expect(names.nth(2)).toHaveText("Task 03");

    // When the owner taps a row's name
    await names.nth(2).tap();

    // Then its card opens
    await expect(page.getByTestId("details-panel")).toContainText("Task 03");
  });

  test("a refused save puts the row back and says so above the list", async ({
    context,
    page,
  }) => {
    // Given fourteen placed employees and a server that refuses the move
    await placed();
    await signInAsOwner(context);
    await page.route("**/api/office/sessions/rank", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(14);

    // When the owner drags the first row three rows down
    await touchDrag(
      page,
      await centerOf(row(page, 1).getByTestId("row-grip")),
      await centerOf(row(page, 4)),
      { holdMs: 400 },
    );

    // Then the row is back first and the alert says it could not move
    await expect(
      page.getByTestId("phone-list").getByRole("alert"),
    ).toContainText("Could not move");
    await expect(names.first()).toHaveText("Task 01");
  });
});

test.describe("holding a grip on an iPad", () => {
  test.use({
    viewport: { width: 834, height: 1194 },
    hasTouch: true,
    isMobile: true,
  });

  test("moves a row in the list beside the office with one request", async ({
    context,
    page,
  }) => {
    // Given four placed employees in the Mac's list, shown to a touch screen
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: `Task ${name}`,
        state: "idle",
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    const requests = countRankRequests(page);
    await page.goto("/");
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveCount(4);
    const rows = page.getByTestId("list-row");

    // When the owner holds the last row's grip and drags it to the top
    await touchDrag(
      page,
      await centerOf(rows.nth(3).getByTestId("row-grip")),
      await centerOf(rows.first()),
      { holdMs: 400 },
    );

    // Then it is first, with one request
    await expect(names).toHaveText(["Task D", "Task A", "Task B", "Task C"]);
    await expect.poll(() => requests.count).toBe(1);
  });
});

test.describe("the phone's settings", () => {
  test("switch the phone between the List and today's Rooms, which keep their Went home bar, and the choice holds after a reload", async ({
    context,
    page,
  }) => {
    // Given a phone that shows the list, with one employee
    await seed([
      {
        sessionId: "a",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Task A",
        state: "idle",
        rank: "b",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await expect(page.getByTestId("phone-list")).toBeVisible();

    // When the owner opens the settings and picks Rooms
    await page.getByRole("button", { name: "Settings" }).click();
    const sheet = page.getByRole("dialog", { name: "Settings" });
    await expect(sheet.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sheet.getByRole("button", { name: /^Rooms/ }).click();

    // Then the rooms replace the list
    await expect(page.getByTestId("phone-list")).toHaveCount(0);
    await expect(page.getByTestId("stacked-rooms")).toBeVisible();

    // When the owner closes the settings
    await sheet.getByRole("button", { name: "Close" }).click();

    // Then the bottom bar offers Went home and Hire, and the Settings button has focus
    await expect(
      page.getByRole("button", { name: /^Went home/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();

    // And the rooms are still there after a reload
    await page.reload();
    await expect(page.getByTestId("stacked-rooms")).toBeVisible();

    // When the owner picks List again
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /^List/ }).click();

    // Then the list is back
    await expect(page.getByTestId("phone-list")).toBeVisible();
  });

  test("Escape closes the sheet and returns focus to the Settings button, a card closes before the sheet opens, and the strip still fits the screen", async ({
    context,
    page,
  }) => {
    // Given a phone with an employee whose card is open
    await seed([
      {
        sessionId: "a",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Task A",
        state: "idle",
        rank: "b",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await page.getByTestId("list-row-name").first().tap();
    await expect(page.getByTestId("details-panel")).toBeVisible();

    // When the owner opens the settings
    const button = page.getByRole("button", { name: "Settings" });
    await button.tap();

    // Then the card is gone, the sheet is open and the bottom bar is out of its way
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hire" })).toHaveCount(0);

    // And the page is no wider than the screen
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    // When the owner presses Escape
    await page.keyboard.press("Escape");

    // Then the sheet closes and focus is back on the button
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("the Settings sheet's switch takes the other companies out of Needs you and out of Move all, and keeps them out after a reload", async ({
    context,
    page,
  }) => {
    // Given a phone whose own company has a Review employee and whose other company has one too
    await seed([
      {
        sessionId: "mine",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Own review",
        state: "review",
        stateSince: new Date(),
        rank: "b",
      },
      {
        sessionId: "theirs",
        cwd: WORK,
        startCwd: WORK,
        deskName: "Their review",
        state: "review",
        stateSince: new Date(),
        rank: "b",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    const needs = page.getByTestId("needs-you");
    await expect(needs).toContainText("Their review");
    await expect(
      needs.getByRole("button", { name: /Move all 2 Review to Idle/ }),
    ).toBeVisible();

    // When the owner turns the switch off in the Settings sheet
    await page.getByRole("button", { name: "Settings" }).tap();
    const sheet = page.getByRole("dialog", { name: "Settings" });
    const toggle = sheet.getByRole("switch", {
      name: "Needs you includes other companies",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.tap();
    await sheet.getByRole("button", { name: "Close" }).tap();

    // Then Needs you lists only the viewed company and Move all counts only it
    await expect(needs).toContainText("Own review");
    await expect(needs).not.toContainText("Their review");
    await expect(
      needs.getByRole("button", { name: /Move all 1 Review to Idle/ }),
    ).toBeVisible();

    // And the choice holds after a reload
    await page.reload();
    await expect(page.getByTestId("needs-you")).not.toContainText(
      "Their review",
    );
  });

  test("opening Settings closes the Went home sheet, and a scrim over the strip and the rows blocks them", async ({
    context,
    page,
  }) => {
    // Given a phone on the Rooms view with its Went home sheet open
    await seed([
      {
        sessionId: "a",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Task A",
        state: "idle",
        rank: "b",
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
    await page.goto("/");
    await page.getByRole("button", { name: /^Went home/ }).tap();
    await expect(
      page.getByRole("dialog", { name: "Went home today" }),
    ).toBeVisible();

    // When the owner opens the settings
    await page.getByRole("button", { name: "Settings" }).tap();

    // Then only the settings are open
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Went home today" }),
    ).toHaveCount(0);

    // And the scrim sits over the whole screen, so the strip's buttons are behind it
    const scrim = page.getByTestId("settings-scrim");
    const box = await scrim.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toMatchObject({
      x: 0,
      y: 0,
      width: viewport?.width,
      height: viewport?.height,
    });
    const allCompanies = await centerOf(
      page.getByRole("button", { name: "All companies" }),
    );
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        allCompanies,
      ),
    ).toBe("settings-scrim");
  });

  test("a second phone still shows the list, and a Mac opens its own settings", async ({
    browser,
    context,
    page,
  }) => {
    // Given the first phone switched to Rooms
    await seed([
      {
        sessionId: "a",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Task A",
        state: "idle",
        rank: "b",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).tap();
    await page.getByRole("button", { name: /^Rooms/ }).tap();
    await expect(page.getByTestId("stacked-rooms")).toBeVisible();

    // When a fresh phone and a Mac open the office
    const phone = await browser.newContext({
      ...devices["iPhone 15"],
      baseURL: E2E_BASE_URL,
    });
    const mac = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    });
    try {
      await signInAsOwner(phone);
      const phonePage = await phone.newPage();
      await phonePage.goto("/");
      await signInAsOwner(mac);
      const macPage = await mac.newPage();
      await macPage.goto("/");

      // Then the phone shows the list and the Mac its list panel, whose Settings button opens the Mac's dialog
      await expect(phonePage.getByTestId("phone-list")).toBeVisible();
      await expect(macPage.getByTestId("list-panel")).toBeVisible();
      await macPage.getByRole("button", { name: "Settings" }).click();
      await expect(
        macPage.getByRole("dialog", { name: "Settings" }),
      ).toContainText("List when the office opens");
    } finally {
      await phone.close();
      await mac.close();
    }
  });
});
