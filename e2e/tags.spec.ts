import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  bottomOf,
  clickEmployee,
  employeeLabelled,
  keepOneCompany,
  overlaps,
  type SeedSession,
  seedSessions,
  showRooms,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

keepOneCompany("m1", "/Users/q/personal");

const API = { name: "api", key: "aaaaaaaaaaaa" };
const WEB = { name: "web", key: "bbbbbbbbbbbb" };

/** Three employees (two tags between them, one with none) and a tagged one that went home. */
const SESSIONS: SeedSession[] = [
  { sessionId: "a", tags: [API, WEB] },
  { sessionId: "b", tags: [API] },
  { sessionId: "c" },
  { sessionId: "d", tags: [WEB], state: "wentHome", endedAt: new Date() },
];

test.describe("repo tag filter", () => {
  test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });
  let client: MongoClient;
  let sessions: Collection;

  test.beforeEach(async ({ context }) => {
    client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
    await client.connect();
    sessions = client.db(E2E_DB).collection("sessions");
    await seedSessions(sessions, SESSIONS);
    await signInAsOwner(context);
  });

  test.afterEach(async () => {
    await sessions.deleteMany({});
    await client.close();
  });

  /** The pill that opens the chip panel. */
  const pillOf = (page: Page) =>
    page.getByTestId("tag-filter").locator("button[aria-expanded]");

  /** Opens the chip panel and returns it. */
  async function openPanel(page: Page) {
    await pillOf(page).click();
    const panel = page.getByRole("dialog", { name: "Filter by repo" });
    await expect(panel).toBeVisible();
    return panel;
  }

  test("a chip narrows the office to the sessions with that tag, the pill reads #api 2 of 3, counts stay put, the company strip is untouched, and × shows everyone again", async ({
    page,
  }) => {
    // Given the company with three employees and a closed All repos pill
    await page.goto("/");
    await waitForEmployees(page, 3);
    await expect(pillOf(page)).toHaveText("All repos 3");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const stripBefore = await page.getByTestId("company-tab").textContent();

    // When the owner opens the pill and picks the api tag
    let panel = await openPanel(page);
    await expect(panel.getByRole("button")).toHaveText([
      "All 3",
      "api 2",
      "web 1",
      "No tag 1",
    ]);
    await panel.getByRole("button", { name: "api 2" }).click();

    // Then two employees stand in the office, the panel closed and the pill shows the pick
    await waitForEmployees(page, 2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pillOf(page)).toHaveText("#api 2 of 3");
    // And the company strip counts and badges are those of the whole company
    expect(await page.getByTestId("company-tab").textContent()).toBe(
      stripBefore,
    );

    // And re-opening shows api pressed with no count moved
    panel = await openPanel(page);
    await expect(panel.getByRole("button", { name: "api 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.getByRole("button")).toHaveText([
      "All 3",
      "api 2",
      "web 1",
      "No tag 1",
    ]);

    // When the owner picks No tag
    await panel.getByRole("button", { name: "No tag 1" }).click();
    await waitForEmployees(page, 1);
    await expect(pillOf(page)).toHaveText("No tag 1 of 3");

    // When the owner presses ×
    await page.getByRole("button", { name: "Show all repos" }).click();

    // Then everyone is back
    await waitForEmployees(page, 3);
    await expect(pillOf(page)).toHaveText("All repos 3");
  });

  test("double-clicking the viewed tab to rename it keeps the repo filter on", async ({
    page,
  }) => {
    // Given the filter narrowed to api
    await page.goto("/");
    await waitForEmployees(page, 3);
    const panel = await openPanel(page);
    await panel.getByRole("button", { name: "api 2" }).click();
    await waitForEmployees(page, 2);
    await expect(pillOf(page)).toHaveText("#api 2 of 3");

    // When the owner double-clicks the viewed tab, so its name editor opens
    await page.getByTestId("company-tab").dblclick();
    await expect(page.getByLabel(/^Name for folder/)).toBeVisible();

    // Then the filter is still on
    await expect(pillOf(page)).toHaveText("#api 2 of 3");
    expect(
      await page.evaluate(
        () => window.__officeTestHooks?.getCharacters().length,
      ),
    ).toBe(2);
  });

  test("the filter takes no height from the office", async ({ page }) => {
    // Given the office height without any tag
    await seedSessions(sessions, [{ sessionId: "a" }, { sessionId: "b" }]);
    await page.goto("/");
    await waitForEmployees(page, 2);
    await expect(page.getByTestId("tag-filter")).toHaveCount(0);
    const heightOf = async () =>
      (await page.getByTestId("office-canvas").boundingBox())?.height;
    const without = await heightOf();

    // When the sessions carry tags and the filter appears
    await seedSessions(sessions, SESSIONS);
    await page.reload();
    await waitForEmployees(page, 3);
    await expect(page.getByTestId("tag-filter")).toBeVisible();

    // Then the canvas is exactly as tall as before
    expect(await heightOf()).toBe(without);
  });

  test("a selected tag that disappears falls back to All", async ({ page }) => {
    // Given the web tag selected
    await page.goto("/");
    await waitForEmployees(page, 3);
    await (await openPanel(page))
      .getByRole("button", { name: "web 1" })
      .click();
    await waitForEmployees(page, 1);

    // When the only session with that tag loses it
    await sessions.updateOne(
      { sessionId: "a" },
      { $unset: { tags: "" }, $set: { changedAt: new Date() } },
    );

    // Then the office shows everyone again
    await waitForEmployees(page, 3);

    // When the tag comes back on a session
    await sessions.updateOne(
      { sessionId: "a" },
      { $set: { tags: [WEB], changedAt: new Date() } },
    );

    // Then its chip returns but the owner's old pick does not: everyone stays shown
    const panel = await openPanel(page);
    await expect(panel.getByRole("button", { name: "web 1" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "All 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitForEmployees(page, 3);
  });

  test("closes the details panel when the chosen tag hides its employee", async ({
    page,
  }) => {
    // Given one employee per tag, and the details of the api one open
    await seedSessions(sessions, [
      { sessionId: "a", deskName: "alpha", tags: [API] },
      { sessionId: "b", deskName: "beta", tags: [WEB] },
    ]);
    await page.goto("/");
    await waitForEmployees(page, 2);
    await clickEmployee(page, await employeeLabelled(page, "alpha"));
    await expect(page.getByTestId("details-panel")).toBeVisible();

    // When the owner picks the web tag, which that employee lacks
    await (await openPanel(page))
      .getByRole("button", { name: "web 1" })
      .click();

    // Then the panel is gone and nobody is selected
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__officeTestHooks?.getSelectedAgentId()),
    ).toBeNull();
  });

  test("a pick does not come back when the owner leaves its company and returns", async ({
    page,
  }) => {
    // Given a second company with one employee, and the api tag picked in the first
    await seedSessions(sessions, [
      ...SESSIONS,
      { sessionId: "e", cwd: "/Users/q/other" },
    ]);
    await page.goto("/");
    await page.locator('[data-company-name="personal"]').click();
    await waitForEmployees(page, 3);
    await (await openPanel(page))
      .getByRole("button", { name: "api 2" })
      .click();
    await waitForEmployees(page, 2);

    // When the owner goes to the other company and back
    await page.locator('[data-company-name="other"]').click();
    await waitForEmployees(page, 1);
    await page.locator('[data-company-name="personal"]').click();

    // Then everyone is shown again
    await waitForEmployees(page, 3);
    await expect(pillOf(page)).toHaveText("All repos 3");
  });

  test("the details card opens below the pill, never over it, whether or not the company has tags", async ({
    page,
  }) => {
    // Given a tagged company and an employee's details open
    await page.goto("/");
    await waitForEmployees(page, 3);
    const [first] =
      (await page.evaluate(() =>
        window.__officeTestHooks?.getCharacters().map((c) => c.id),
      )) ?? [];
    await clickEmployee(page, first);
    const card = page.getByTestId("details-panel");
    await expect(card).toBeVisible();

    // Then the card does not cover the pill
    expect(await overlaps(pillOf(page), card)).toBe(false);
    const taggedTop = (await card.boundingBox())?.y;

    // When the company has no tags and the same card opens
    await seedSessions(sessions, [{ sessionId: "a" }, { sessionId: "b" }]);
    await page.reload();
    await waitForEmployees(page, 2);
    await expect(page.getByTestId("tag-filter")).toHaveCount(0);
    const [only] =
      (await page.evaluate(() =>
        window.__officeTestHooks?.getCharacters().map((c) => c.id),
      )) ?? [];
    await clickEmployee(page, only);
    await expect(card).toBeVisible();

    // Then it sits in the same spot, so it does not jump
    expect((await card.boundingBox())?.y).toBe(taggedTop);
  });

  test("the panel closes on Escape, on a click on the office, and when the companies drawer opens", async ({
    page,
  }) => {
    // Given the panel open
    await page.goto("/");
    await waitForEmployees(page, 3);
    await openPanel(page);

    // When the owner presses Escape
    await page.keyboard.press("Escape");

    // Then it closes and the pill has focus
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pillOf(page)).toBeFocused();

    // When it is open and the owner clicks the empty office
    await openPanel(page);
    const canvas = await page.getByTestId("office-canvas").boundingBox();
    if (!canvas) throw new Error("the office canvas has no box");
    await page.mouse.click(canvas.x + canvas.width - 5, canvas.y + 5);

    // Then it closes
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // When it is open and the owner clicks the company drawer button
    await openPanel(page);
    await page.getByTestId("open-drawer").click();

    // Then the panel is gone and only the drawer is open
    await expect(
      page.getByRole("dialog", { name: "Filter by repo" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "All companies" }),
    ).toBeVisible();
  });
});

// The "phone" project's device profile applies: 393 x 852, dpr 3, touch.
test.describe("repo tag filter on a phone", () => {
  let client: MongoClient;
  let sessions: Collection;

  test.beforeEach(async ({ context }) => {
    client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
    await client.connect();
    sessions = client.db(E2E_DB).collection("sessions");
    // Enough working employees that the rooms scroll.
    await seedSessions(sessions, [
      {
        sessionId: "a",
        tags: [API, WEB],
        state: "working",
        deskName: "Task a",
      },
      {
        sessionId: "b",
        tags: [API],
        state: "needsPermission",
        deskName: "Task b",
      },
      { sessionId: "c", deskName: "Task c" },
      ...Array.from({ length: 10 }, (_, n) => ({
        sessionId: `k${n}`,
        tags: [WEB],
        state: "working",
        deskName: `Task k${n}`,
      })),
    ]);
    await signInAsOwner(context);
    await showRooms(context);
  });

  test.afterEach(async () => {
    await sessions.deleteMany({});
    await client.close();
  });

  const tiles = (page: Page) =>
    page
      .getByTestId("stacked-rooms")
      .getByRole("button", { name: /^Task .+, (?!\d)/ });

  for (const [label, size] of [
    ["upright", { width: 393, height: 852 }],
    ["sideways", { width: 852, height: 393 }],
  ] as const) {
    test(`${label}: the pill sits above the rooms and stays while they scroll, opens a bottom sheet that hides the bottom bar, and a pick narrows the rooms and closes the sheet`, async ({
      page,
    }) => {
      // Given a phone with thirteen employees in scrolling rooms
      await page.setViewportSize(size);
      await page.goto("/");
      const rooms = page.getByTestId("stacked-rooms");
      await expect(tiles(page)).toHaveCount(13);
      const pill = page
        .getByTestId("tag-filter")
        .locator("button[aria-expanded]");
      await expect(pill).toHaveText("All repos 13");

      // Then the pill is above the rooms, not over a room header
      const pillBox = await pill.boundingBox();
      const roomsBox = await rooms.boundingBox();
      expect((pillBox?.y ?? 0) + (pillBox?.height ?? 0)).toBeLessThanOrEqual(
        roomsBox?.y ?? 0,
      );
      expect(pillBox?.height).toBeGreaterThanOrEqual(44);

      // And it is still in view after the rooms scroll to the end
      await rooms.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(pill).toBeInViewport();
      await rooms.evaluate((el) => el.scrollTo(0, 0));

      // When the owner taps the pill
      await pill.tap();

      // Then the chips open as a sheet at the screen's bottom and the bottom bar steps aside
      const sheet = page.getByRole("dialog", { name: "Filter by repo" });
      await expect(sheet).toBeVisible();
      expect(await bottomOf(sheet)).toBeCloseTo(size.height, 0);
      await expect(page.getByTestId("phone-bottom-bar")).toHaveCount(0);

      // And every chip is a full-size tap target
      const chipHeights = await sheet
        .getByRole("button", { name: /\d$/ })
        .evaluateAll((chips) =>
          chips.map((chip) => chip.getBoundingClientRect().height),
        );
      expect(chipHeights).toHaveLength(4);
      for (const height of chipHeights)
        expect(height).toBeGreaterThanOrEqual(44);

      // When the owner picks the api tag
      await sheet.getByRole("button", { name: "api 2" }).tap();

      // Then two employees are left, the sheet is closed and the bar is back
      await expect(tiles(page)).toHaveCount(2);
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId("phone-bottom-bar")).toBeVisible();
      await expect(pill).toHaveText("#api 2 of 13");

      // When the owner taps ×
      await page.getByRole("button", { name: "Show all repos" }).tap();

      // Then everyone is back
      await expect(tiles(page)).toHaveCount(13);
    });
  }

  test("a tap on the scrim closes the sheet without picking", async ({
    page,
  }) => {
    // Given the sheet open
    await page.goto("/");
    await expect(tiles(page)).toHaveCount(13);
    await page.getByTestId("tag-filter").locator("button[aria-expanded]").tap();
    const sheet = page.getByRole("dialog", { name: "Filter by repo" });
    await expect(sheet).toBeVisible();

    // When the owner taps the dimmed area over a room tile above the sheet
    const sheetTop = (await sheet.boundingBox())?.y ?? 0;
    const tile = (await tiles(page).first().boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    expect(tile.y + tile.height).toBeLessThan(sheetTop);
    await page.getByTestId("tag-filter-scrim").tap({
      position: { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 },
    });

    // Then it closes, nothing was picked and the tile underneath did not open its details
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(13);
  });
});
