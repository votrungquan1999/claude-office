import { expect, type Page, test } from "@playwright/test";
import {
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
  withE2eDb,
} from "./helpers";

test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

const PERSONAL = "/Users/q/personal/app";
const WORK = "/Users/q/work/api";

/** Two companies on one online Mac, each with a Review employee; personal is shown first. */
test.beforeEach(async () => {
  await withE2eDb(async (db) => {
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/personal" },
      { machineId: "air", path: "/Users/q/work" },
    ]);
    await db.collection("machines").deleteMany({});
    await seedSessions(db.collection("sessions"), [
      {
        sessionId: "mine",
        machineId: "air",
        machineName: "Air",
        cwd: PERSONAL,
        startCwd: PERSONAL,
        deskName: "Own review",
        state: "review",
        stateSince: new Date(),
        rank: "b",
      },
      {
        sessionId: "theirs",
        machineId: "air",
        machineName: "Air",
        cwd: WORK,
        startCwd: WORK,
        deskName: "Other review",
        state: "review",
        stateSince: new Date(),
        rank: "b",
      },
    ]);
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

/** Opens the office and waits for its list. */
async function openOffice(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("list-row")).toHaveCount(1);
}

test("by default the list is open, the tab counts everyone who needs the owner, and Needs you lists the other company", async ({
  context,
  page,
}) => {
  // Given two companies that each have a Review employee
  await signInAsOwner(context);

  // When the owner opens the office
  await openOffice(page);

  // Then the list is open, the tab says 2, and Needs you has the other company's block
  await expect(page.getByTestId("list-panel")).toBeVisible();
  await expect(page).toHaveTitle("(2) Claude Office");
  await expect(
    page.getByTestId("needs-you").getByText("In other companies"),
  ).toBeVisible();
});

test("picking Folded folds the list to its strip now and at every load, and picking Open opens it, while a section the owner folded stays folded", async ({
  context,
  page,
}) => {
  // Given the office with its list open and the Everyone section folded by the owner
  await signInAsOwner(context);
  await openOffice(page);
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const everyone = page
    .getByTestId("list-panel")
    .getByRole("button", { name: /^Everyone/ });
  await everyone.click();
  await expect(everyone).toHaveAttribute("aria-expanded", "false");

  // When the owner opens the settings and picks Folded
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("button", { name: "Folded" }).click();

  // Then the list folds to its strip, which still shows the needs-you count
  const strip = page.getByTestId("list-folded-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("2");

  // And after a reload it starts folded
  await page.reload();
  await expect(strip).toBeVisible();

  // When the owner opens the strip by hand, reloads and the list is folded again
  await strip.click();
  await expect(page.getByTestId("list-panel")).toBeVisible();
  await expect(everyone).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(strip).toBeVisible();

  // When the owner picks Open
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("button", { name: "Open" }).click();

  // Then the list opens and the section is still folded
  await expect(page.getByTestId("list-panel")).toBeVisible();
  await expect(everyone).toHaveAttribute("aria-expanded", "false");
});

test("turning the tab count off puts the plain title back at once, and on again brings the count back", async ({
  context,
  page,
}) => {
  // Given the office whose tab says 2
  await signInAsOwner(context);
  await openOffice(page);
  await expect(page).toHaveTitle("(2) Claude Office");

  // When the owner turns the count off
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Count in the browser tab" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();

  // Then the title is the plain name
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page).toHaveTitle("Claude Office");

  // When the owner turns it on again
  await toggle.click();

  // Then the count is back
  await expect(page).toHaveTitle("(2) Claude Office");
});

test("turning other companies off leaves only the viewed company in Needs you and Move all, and the tab still counts everyone", async ({
  context,
  page,
}) => {
  // Given Needs you listing both companies and Move all covering both
  await signInAsOwner(context);
  await openOffice(page);
  const needs = page.getByTestId("list-panel").getByTestId("needs-you");
  await expect(needs.getByText("In other companies")).toBeVisible();
  await expect(
    needs.getByRole("button", { name: "Move all 2 Review to Idle" }),
  ).toBeVisible();

  // When the owner turns "Needs you includes other companies" off
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", {
    name: "Needs you includes other companies",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();

  // Then the other company's block is gone and Move all counts only the viewed company
  await expect(needs.getByText("In other companies")).toHaveCount(0);
  await expect(
    needs.getByRole("button", { name: "Move all 1 Review to Idle" }),
  ).toBeVisible();

  // And the tab still counts both
  await expect(page).toHaveTitle("(2) Claude Office");
});

test("the switches keep their positions after a reload", async ({
  context,
  page,
}) => {
  // Given both switches turned off
  await signInAsOwner(context);
  await openOffice(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Count in the browser tab" }).click();
  await page
    .getByRole("switch", { name: "Needs you includes other companies" })
    .click();

  // When the owner reloads and opens the settings again
  await page.reload();
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings" }).click();

  // Then both are still off, and so are their effects
  await expect(
    page.getByRole("switch", { name: "Count in the browser tab" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("switch", { name: "Needs you includes other companies" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(page).toHaveTitle("Claude Office");
  await expect(
    page.getByTestId("needs-you").getByText("In other companies"),
  ).toHaveCount(0);
});

test("opening Settings while the All companies drawer is open closes the drawer", async ({
  context,
  page,
}) => {
  // Given the office with the All companies drawer open
  await signInAsOwner(context);
  await openOffice(page);
  await page.getByRole("button", { name: "All companies" }).click();
  await expect(
    page.getByRole("dialog", { name: "All companies" }),
  ).toBeVisible();

  // When the owner opens the settings
  await page.getByRole("button", { name: "Settings" }).click();

  // Then only the settings are open
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "All companies" })).toHaveCount(
    0,
  );
});

test("the X, Escape and a click outside close the dialog and give focus back to the Settings button, and an open card closes first", async ({
  context,
  page,
}) => {
  // Given the office with an employee's card open
  await signInAsOwner(context);
  await openOffice(page);
  await page.getByTestId("list-row-name").first().click();
  await expect(page.getByTestId("details-panel")).toBeVisible();
  const button = page.getByRole("button", { name: "Settings" });
  const dialog = page.getByRole("dialog", { name: "Settings" });

  // When the owner opens the settings
  await button.click();

  // Then the card is gone and the dialog is up
  await expect(page.getByTestId("details-panel")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // When the owner closes it with the X, Escape and a click on the scrim in turn
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await page
    .getByTestId("settings-scrim")
    .click({ position: { x: 10, y: 400 } });

  // Then each time it closed and focus came back
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("Cmd+K does nothing while the Settings dialog is open", async ({
  context,
  page,
}) => {
  // Given the office with the Settings dialog open
  await signInAsOwner(context);
  await openOffice(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  // When the owner presses Cmd+K
  await page.keyboard.press("Meta+k");

  // Then no palette opens over it
  await expect(
    page.getByRole("dialog", { name: "Find an employee" }),
  ).toHaveCount(0);
});
