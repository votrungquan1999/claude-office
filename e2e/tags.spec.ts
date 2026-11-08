import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  keepOneCompany,
  type SeedSession,
  seedSessions,
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

  test("a chip narrows the office to the sessions with that tag, counts stay put, and the company strip is untouched", async ({
    page,
  }) => {
    // Given the company with three employees
    await page.goto("/");
    await waitForEmployees(page, 3);
    const chips = page.getByRole("group", { name: "Filter by repo tag" });
    await expect(chips.getByRole("button")).toHaveText([
      "All 3",
      "api 2",
      "web 1",
      "No tag 1",
    ]);
    const stripBefore = await page.getByTestId("company-tab").textContent();

    // When the owner picks the api tag
    await chips.getByRole("button", { name: "api 2" }).click();

    // Then two employees stand in the office, the chip is pressed and no count moved
    await waitForEmployees(page, 2);
    await expect(chips.getByRole("button", { name: "api 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(chips.getByRole("button")).toHaveText([
      "All 3",
      "api 2",
      "web 1",
      "No tag 1",
    ]);
    // And the company strip counts and badges are those of the whole company
    expect(await page.getByTestId("company-tab").textContent()).toBe(
      stripBefore,
    );

    // When the owner picks No tag, then All
    await chips.getByRole("button", { name: "No tag 1" }).click();
    await waitForEmployees(page, 1);
    await chips.getByRole("button", { name: "All 3" }).click();

    // Then everyone is back
    await waitForEmployees(page, 3);
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

  test("the tag chips leave the all-companies button inside the strip's visible width", async ({
    page,
  }) => {
    // Given a company whose sessions carry tags
    await page.goto("/");
    await waitForEmployees(page, 3);
    await expect(page.getByTestId("tag-filter")).toBeVisible();

    // Then the button that opens the drawer is on screen without scrolling the strip
    const box = await page.getByTestId("open-drawer").boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect((box?.x ?? width) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });

  test("a selected tag that disappears falls back to All", async ({ page }) => {
    // Given the web tag selected
    await page.goto("/");
    await waitForEmployees(page, 3);
    const chips = page.getByRole("group", { name: "Filter by repo tag" });
    await chips.getByRole("button", { name: "web 1" }).click();
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
    await expect(chips.getByRole("button", { name: "web 1" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "All 3" })).toHaveAttribute(
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
    await page.getByTestId("agent-card").filter({ hasText: "alpha" }).click();
    await expect(page.getByTestId("details-panel")).toBeVisible();

    // When the owner picks the web tag, which that employee lacks
    await page
      .getByRole("group", { name: "Filter by repo tag" })
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
    const chips = page.getByRole("group", { name: "Filter by repo tag" });
    await chips.getByRole("button", { name: "api 2" }).click();
    await waitForEmployees(page, 2);

    // When the owner goes to the other company and back
    await page.locator('[data-company-name="other"]').click();
    await waitForEmployees(page, 1);
    await page.locator('[data-company-name="personal"]').click();

    // Then everyone is shown again
    await waitForEmployees(page, 3);
    await expect(chips.getByRole("button", { name: "All 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("repo tag filter on a sideways phone", () => {
  test.use({ viewport: { width: 852, height: 393 } });
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

  test("lives in the drawer behind the compact button, and a chip there narrows the office", async ({
    page,
  }) => {
    // Given the sideways office, where the strip is folded into one button
    await page.goto("/");
    await waitForEmployees(page, 3);
    await expect(page.getByTestId("company-strip")).toHaveCount(0);

    // When the owner opens the drawer and picks the api chip
    await page.getByTestId("compact-company-button").tap();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await drawer
      .getByRole("group", { name: "Filter by repo tag" })
      .getByRole("button", { name: "api 2" })
      .tap();

    // Then two employees stand in the office
    await waitForEmployees(page, 2);
  });
});
