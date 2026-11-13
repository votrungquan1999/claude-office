import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./constants";
import {
  clickEmployee,
  seedFolders,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

test.describe("moving a Review employee to Idle", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("from its card shows Idle on this device at once and on a phone after its next poll, with one request, while its Mac is offline", async ({
    browser,
    context,
    page,
  }) => {
    // Given a Review employee on a Mac with no sign of life, and a phone that already has the office open
    await withE2eDb(async (db) => {
      await seedFolders(db.collection("folders"), [
        { machineId: "air", path: "/Users/q/personal" },
      ]);
      await db.collection("machines").deleteMany({});
      await seedSessions(db.collection("sessions"), [
        {
          sessionId: "r1",
          machineId: "air",
          machineName: "Air",
          cwd: "/Users/q/personal",
          startCwd: "/Users/q/personal",
          state: "review",
          deskName: "Audit signup emails",
          stateSince: new Date(Date.now() - 18 * 60_000),
        },
      ]);
    });
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/review-seen"))
        requests.push(request.postData() ?? "");
    });
    const phoneContext = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await signInAsOwner(phoneContext);
    const phone = await phoneContext.newPage();

    try {
      await phone.goto("/");
      // The Mac is offline, so the row's state word says so; its Idle button marks the Review
      const phoneIdle = phone
        .getByTestId("list-row")
        .getByRole("button", { name: "Move to Idle" });
      await expect(phoneIdle).toBeVisible();
      await page.goto("/");
      await waitForEmployees(page, 1);
      const id = await page.evaluate(
        () => window.__officeTestHooks?.getCharacters()[0].id ?? -1,
      );
      await clickEmployee(page, id);
      const panel = page.getByTestId("details-panel");

      // When the owner presses Move to Idle on its card
      await panel.getByRole("button", { name: "Move to Idle" }).click();

      // Then this device shows it Idle at once, with one request
      const tab = page.getByTestId("company-tab");
      await expect(tab.getByLabel("0 review")).toBeVisible();
      await expect(tab.getByLabel("1 idle")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Move to Idle" }),
      ).toHaveCount(0);
      expect(requests).toHaveLength(1);

      // And the phone shows it in Idle after its next poll
      await expect(phoneIdle).toHaveCount(0, { timeout: 15_000 });

      // And after a reload this device still shows it Idle, as every device does
      await page.reload();
      await expect(
        page.getByTestId("company-tab").getByLabel("1 idle"),
      ).toBeVisible();
    } finally {
      await withE2eDb(async (db) => {
        await seedFolders(db.collection("folders"), []);
        await db.collection("sessions").deleteMany({});
      });
      await phoneContext.close();
    }
  });

  test("puts the Review back with an alert when the server refuses the move", async ({
    context,
    page,
  }) => {
    // Given a Review employee and a server that refuses the move
    await withE2eDb(async (db) => {
      await seedFolders(db.collection("folders"), [
        { machineId: "air", path: "/Users/q/personal" },
      ]);
      await db.collection("machines").deleteMany({});
      await seedSessions(db.collection("sessions"), [
        {
          sessionId: "r1",
          machineId: "air",
          machineName: "Air",
          cwd: "/Users/q/personal",
          startCwd: "/Users/q/personal",
          state: "review",
          deskName: "Audit signup emails",
          stateSince: new Date(Date.now() - 18 * 60_000),
        },
      ]);
    });
    await signInAsOwner(context);
    await page.route("**/api/office/sessions/review-seen", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );

    try {
      await page.goto("/");
      await waitForEmployees(page, 1);
      const id = await page.evaluate(
        () => window.__officeTestHooks?.getCharacters()[0].id ?? -1,
      );
      await clickEmployee(page, id);
      const panel = page.getByTestId("details-panel");

      // When the owner presses Move to Idle
      await panel.getByRole("button", { name: "Move to Idle" }).click();

      // Then the card says it did not go through, and the employee is in Review again
      await expect(panel.getByRole("alert")).toHaveText(
        "Could not move to Idle. Try again.",
      );
      const tab = page.getByTestId("company-tab");
      await expect(tab.getByLabel("1 review")).toBeVisible();
      await expect(tab.getByLabel("0 idle")).toBeVisible();
    } finally {
      await withE2eDb(async (db) => {
        await seedFolders(db.collection("folders"), []);
        await db.collection("sessions").deleteMany({});
      });
    }
  });
});
