import { expect, test } from "@playwright/test";
import {
  clearCommands,
  readCommands,
  seedFolders,
  seedSessions,
  signInAsOwner,
  updateCommand,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

/** Seeds an online Mac, an offline one and one with an old agent, each with folders, and one employee on the online Mac. */
async function seed() {
  await withE2eDb(async (db) => {
    const now = Date.now();
    await db.collection("machines").deleteMany({});
    await db.collection("machines").insertMany([
      {
        machineId: "m-up",
        machineName: "Up Mac",
        lastSeenAt: new Date(now),
        agentVersion: "0.3.0",
      },
      {
        machineId: "m-down",
        machineName: "Down Mac",
        lastSeenAt: new Date(now - 600_000),
        agentVersion: "0.3.0",
      },
      {
        machineId: "m-old",
        machineName: "Old Mac",
        lastSeenAt: new Date(now),
        agentVersion: "0.2.0",
      },
    ]);
    await seedFolders(db.collection("folders"), [
      { machineId: "m-up", path: "/work/app", existsOnMac: true },
      { machineId: "m-up", path: "/work/gone", existsOnMac: false },
      { machineId: "m-down", path: "/work/down" },
      { machineId: "m-old", path: "/work/old" },
    ]);
    await seedSessions(db.collection("sessions"), [
      {
        sessionId: "s-up",
        machineId: "m-up",
        machineName: "Up Mac",
        cwd: "/work/app",
        startCwd: "/work/app",
        deskName: "Existing desk",
      },
    ]);
  });
  await clearCommands();
}

test.beforeEach(seed);
test.afterEach(async () => {
  await clearCommands();
  await withE2eDb(async (db) => {
    await db.collection("machines").deleteMany({});
    await db.collection("sessions").deleteMany({});
    await db.collection("folders").deleteMany({});
  });
});

test("the dialog lists only Macs that can take orders and folders that still exist", async ({
  context,
  page,
}) => {
  // Given the owner is on the office
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);

  // When the owner opens the hire dialog from the company strip
  await page.getByTestId("hire-button").click();
  const dialog = page.getByTestId("hire-dialog");

  // Then the online Mac is picked, the offline and the out-of-date Macs are greyed with a reason
  await expect(page.getByTestId("hire-mac")).toHaveValue("m-up");
  const options = page.getByTestId("hire-mac").locator("option");
  await expect(options.filter({ hasText: "Down Mac" })).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(options.filter({ hasText: "Down Mac" })).toContainText(
    "offline",
  );
  await expect(options.filter({ hasText: "Old Mac" })).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(options.filter({ hasText: "Old Mac" })).toContainText(
    "update this Mac's agent",
  );

  // And the deleted folder is not offered, and hiring needs a message
  const folderOptions = page.getByTestId("hire-folder").locator("option");
  await expect(folderOptions).toHaveText(["/work/app"]);
  await expect(dialog.getByTestId("hire-submit")).toBeDisabled();
});

test("a hire stays in the dialog until its order resolves: not sent after 30 s, a failure's reason, then closed once done", async ({
  context,
  page,
}) => {
  // Given the dialog open on the online Mac's folder
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  await page.getByTestId("hire-button").click();
  await page.getByTestId("hire-message").fill("Fix the login bug");

  // When the owner submits
  await page.getByTestId("hire-submit").click();

  // Then one order for that Mac, folder and message exists and the dialog is still open, locked
  await expect.poll(async () => (await readCommands()).length).toBe(1);
  const [first] = await readCommands();
  expect(first).toMatchObject({
    machineId: "m-up",
    folder: "/work/app",
    firstMessage: "Fix the login bug",
    status: "pending",
  });
  await expect(page.getByTestId("hire-dialog")).toBeVisible();
  await expect(page.getByTestId("hire-outcome")).toContainText("Sending");
  await expect(page.getByTestId("hire-message")).toBeDisabled();

  // When nobody picks it up for 31 s by the database clock
  await updateCommand(first._id, { createdAt: new Date(Date.now() - 31_000) });

  // Then the dialog says it was not sent and lets the owner try again
  await expect(page.getByTestId("hire-outcome")).toContainText("Not sent", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("hire-message")).toBeEnabled();

  // When the owner resends and the Mac reports the folder missing
  await page.getByTestId("hire-submit").click();
  await expect.poll(async () => (await readCommands()).length).toBe(2);
  const second = (await readCommands())[1];
  await updateCommand(second._id, {
    status: "failed",
    reason: "folderMissing",
  });

  // Then the reason shows in the dialog
  await expect(page.getByTestId("hire-outcome")).toContainText(
    "folder is missing on the Mac",
    { timeout: 10_000 },
  );

  // When a third try is done
  await page.getByTestId("hire-submit").click();
  await expect.poll(async () => (await readCommands()).length).toBe(3);
  await updateCommand((await readCommands())[2]._id, { status: "done" });

  // Then the dialog closes by itself
  await expect(page.getByTestId("hire-dialog")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("on a short screen the dialog scrolls, so the Hire button can still be reached", async ({
  context,
  page,
}) => {
  // Given the dialog open with a message, on a screen far shorter than the form (a phone turned sideways, or the keyboard up)
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  await page.getByTestId("hire-button").click();
  await page.getByTestId("hire-message").fill("Fix the login bug");
  await page.setViewportSize({ width: 1000, height: 240 });

  // When the owner scrolls to the Hire button
  const submit = page.getByTestId("hire-submit");
  await submit.scrollIntoViewIfNeeded();

  // Then the button is on screen and can be clicked
  await expect(submit).toBeInViewport();
  await submit.click();
  await expect.poll(async () => (await readCommands()).length).toBe(1);
});
