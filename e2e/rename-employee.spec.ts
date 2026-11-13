import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./constants";
import {
  clickEmployee,
  employeeLabelled,
  hoverEmployee,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

test.describe("renaming an employee", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("from its card shows the owner's name on the card, the canvas label and a phone after its next poll, with one request, and an empty name brings the automatic one back", async ({
    browser,
    context,
    page,
  }) => {
    // Given one employee with an automatic name, and a phone that already has the office open
    await withE2eDb(async (db) => {
      await seedFolders(db.collection("folders"), [
        { machineId: "air", path: "/Users/q/personal" },
      ]);
      await seedOnlineMachine("air", "Air");
      await seedSessions(db.collection("sessions"), [
        {
          sessionId: "e1",
          machineId: "air",
          machineName: "Air",
          cwd: "/Users/q/personal",
          startCwd: "/Users/q/personal",
          state: "idle",
          deskName: "Audit signup emails",
        },
      ]);
    });
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/name"))
        requests.push(request.postData() ?? "");
    });
    const phoneContext = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await signInAsOwner(phoneContext);
    const phone = await phoneContext.newPage();
    const phoneTile = (name: string) =>
      phone.getByTestId("list-row-name").filter({ hasText: name });

    try {
      await phone.goto("/");
      await expect(phoneTile("Audit signup emails")).toBeVisible();
      await page.goto("/");
      await waitForEmployees(page, 1);
      const id = await page.evaluate(
        () => window.__officeTestHooks?.getCharacters()[0].id ?? -1,
      );
      await clickEmployee(page, id);
      const panel = page.getByTestId("details-panel");

      // When the owner renames it from the pencil on its card
      await panel.getByRole("button", { name: "Rename employee" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename employee" });
      await expect(dialog).toContainText(
        'the automatic name back: "Audit signup emails"',
      );
      await dialog.getByLabel("Name").fill("Email auditor");
      await dialog.getByLabel("Name").press("Enter");

      // Then the card shows the new name at once, with one request
      await expect(dialog).toBeHidden();
      await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
        "Email auditor",
      );
      expect(requests).toHaveLength(1);

      // And the canvas label carries it
      await page.keyboard.press("Escape");
      await employeeLabelled(page, "Email auditor");
      await hoverEmployee(page, id);
      await expect(page.getByTestId("agent-overlay").first()).toContainText(
        "Email auditor",
      );

      // And the phone shows it after its next poll
      await expect(phoneTile("Email auditor")).toBeVisible({ timeout: 15_000 });

      // And it is still there after a reload
      await page.reload();
      await waitForEmployees(page, 1);
      await employeeLabelled(page, "Email auditor");

      // When the owner saves an empty name
      await clickEmployee(page, id);
      await panel.getByRole("button", { name: "Rename employee" }).click();
      await dialog.getByLabel("Name").fill("");
      await dialog.getByRole("button", { name: "Save" }).click();

      // Then the automatic name is back on the card and, after its poll, on the phone
      await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
        "Audit signup emails",
      );
      await expect(phoneTile("Audit signup emails")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await withE2eDb(async (db) => {
        await seedFolders(db.collection("folders"), []);
        await db.collection("machines").deleteMany({});
        await db.collection("sessions").deleteMany({});
      });
      await phoneContext.close();
    }
  });

  test("keeps the dialog open with an error when the server refuses, and Escape cancels without a request", async ({
    context,
    page,
  }) => {
    // Given one employee and a server that refuses names
    await withE2eDb(async (db) => {
      await seedFolders(db.collection("folders"), [
        { machineId: "air", path: "/Users/q/personal" },
      ]);
      await seedOnlineMachine("air", "Air");
      await seedSessions(db.collection("sessions"), [
        {
          sessionId: "e1",
          machineId: "air",
          machineName: "Air",
          cwd: "/Users/q/personal",
          startCwd: "/Users/q/personal",
          state: "idle",
          deskName: "Audit signup emails",
        },
      ]);
    });
    await signInAsOwner(context);
    let refused = 0;
    await page.route("**/api/office/sessions/name", (route) => {
      refused += 1;
      return route.fulfill({ status: 404, body: "{}" });
    });

    try {
      await page.goto("/");
      await waitForEmployees(page, 1);
      const id = await page.evaluate(
        () => window.__officeTestHooks?.getCharacters()[0].id ?? -1,
      );
      await clickEmployee(page, id);
      const panel = page.getByTestId("details-panel");
      const dialog = page.getByRole("dialog", { name: "Rename employee" });

      // When the owner saves a name and is refused
      await panel.getByRole("button", { name: "Rename employee" }).click();
      await dialog.getByLabel("Name").fill("Email auditor");
      await dialog.getByRole("button", { name: "Save" }).click();

      // Then the dialog stays with an error and the card keeps the automatic name
      await expect(dialog.getByRole("alert")).toHaveText(
        "Could not rename. Try again.",
      );
      await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
        "Audit signup emails",
      );

      // When the owner presses Escape
      await page.keyboard.press("Escape");

      // Then the dialog closes and only the one refused request was made
      await expect(dialog).toBeHidden();
      expect(refused).toBe(1);
    } finally {
      await withE2eDb(async (db) => {
        await seedFolders(db.collection("folders"), []);
        await db.collection("machines").deleteMany({});
        await db.collection("sessions").deleteMany({});
      });
    }
  });
});
