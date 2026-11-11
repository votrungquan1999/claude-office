import { expect, test } from "@playwright/test";
import {
  clickEmployee,
  hoverEmployee,
  keepOneCompany,
  signInAsOwner,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

const NAME = "Reconcile subscription entitlements between billing services";
const REQUEST =
  "check the latest messesage on the real vn30 conversatino to see\n\nwhat the employee is doing right now and report back";

test.describe("task name and original request", () => {
  test.beforeEach(async ({ context }) => {
    await withE2eDb(async (db) => {
      const sessions = db.collection("sessions");
      await sessions.deleteMany({});
      await sessions.insertOne({
        machineId: "m1",
        machineName: "Studio Mac",
        sessionId: "s1",
        cwd: "/Users/q/work",
        state: "idle",
        deskName: NAME,
        request: REQUEST,
        startedAt: new Date(),
        changedAt: new Date(),
      });
    });
    await signInAsOwner(context);
  });

  test.afterEach(async () => {
    await withE2eDb(async (db) => {
      await db.collection("sessions").deleteMany({});
    });
  });

  test("hovering an employee shows the whole task name, wrapped between words instead of cut", async ({
    page,
  }) => {
    // Given one employee with a short task name
    await page.goto("/");
    await waitForEmployees(page, 1);

    // When the owner hovers it
    await hoverEmployee(page, 1);

    // Then the tooltip holds the full name and none of its text is clipped
    const place = page.getByTestId("agent-place");
    await expect(place).toContainText(NAME);
    const clipped = await place.evaluate(
      (el) =>
        el.scrollWidth > el.clientWidth + 1 ||
        el.scrollHeight > el.clientHeight + 1,
    );
    expect(clipped).toBe(false);
  });

  test("the info icon in the details card opens the original request, and Escape closes it", async ({
    page,
  }) => {
    // Given the details card of the employee
    await page.goto("/");
    await waitForEmployees(page, 1);
    await clickEmployee(page, 1);
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText(NAME);

    // When the owner clicks the info icon
    await panel
      .getByRole("button", { name: "Show the original request" })
      .click();

    // Then the popup shows the whole request and the desk text did not change
    const dialog = page.getByRole("dialog", { name: "Original request" });
    await expect(dialog.getByTestId("request-text")).toHaveText(REQUEST);
    await page.screenshot({
      path: "/private/tmp/claude-501/-Users-quanvo-Documents-git-repos-personal/bb75d6c5-2a99-43ce-b693-9e85c7dfaf05/scratchpad/task-names/details-popup.png",
    });

    // And Escape closes it, and a click outside closes it again
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await panel
      .getByRole("button", { name: "Show the original request" })
      .click();
    await page
      .getByTestId("request-backdrop")
      .click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });
});
