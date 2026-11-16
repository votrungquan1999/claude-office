import { expect, test } from "@playwright/test";
import {
  clearCommands,
  clickEmployee,
  employeeLabelled,
  overlaps,
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

  // When the owner opens the hire dialog from the floating Hire button
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

test("ticking Blank greys out the first message, keeps what was typed without sending it, and hires with no first message", async ({
  context,
  page,
}) => {
  // Given the online Mac runs an agent that takes blank hires, and the dialog is open with nothing typed
  await withE2eDb(async (db) => {
    await db
      .collection("machines")
      .updateOne({ machineId: "m-up" }, { $set: { agentVersion: "0.5.0" } });
  });
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  await page.getByTestId("hire-button").click();
  const message = page.getByTestId("hire-message");
  const submit = page.getByTestId("hire-submit");
  const blank = page.getByRole("checkbox", { name: "Blank" });

  // When the owner ticks Blank, Hire can be pressed with no message; unticked, it cannot
  await blank.check();
  await expect(submit).toBeEnabled();
  await blank.uncheck();
  await expect(submit).toBeDisabled();

  // When the owner types a message and then ticks Blank
  await message.fill("Draft I changed my mind about");
  await blank.check();

  // Then the message box is greyed out with the text still in it
  await expect(message).toBeDisabled();
  await expect(message).toHaveValue("Draft I changed my mind about");

  // When the owner unticks it, the message is editable again with the same text
  await blank.uncheck();
  await expect(message).toBeEnabled();
  await expect(message).toHaveValue("Draft I changed my mind about");

  // When the owner ticks Blank again, clears nothing, and hires
  await blank.check();
  await submit.click();

  // Then one order for that Mac and folder exists, with no first message
  await expect.poll(async () => (await readCommands()).length).toBe(1);
  const [order] = await readCommands();
  expect(order).toMatchObject({
    machineId: "m-up",
    folder: "/work/app",
    status: "pending",
  });
  expect(order).not.toHaveProperty("firstMessage");
});

test("Blank is greyed with a reason for a Mac whose agent is older than 0.5.0, and switching to one never sends a blank hire", async ({
  context,
  page,
}) => {
  // Given the online Mac on 0.5.0 and a second online Mac on 0.4.0, each with a folder
  await withE2eDb(async (db) => {
    await db
      .collection("machines")
      .updateOne({ machineId: "m-up" }, { $set: { agentVersion: "0.5.0" } });
    await db.collection("machines").insertOne({
      machineId: "m-mid",
      machineName: "Mid Mac",
      lastSeenAt: new Date(),
      agentVersion: "0.4.0",
    });
    await seedFolders(db.collection("folders"), [
      { machineId: "m-mid", path: "/work/mid", existsOnMac: true },
    ]);
  });
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  await page.getByTestId("hire-button").click();
  const blank = page.getByRole("checkbox", { name: "Blank" });
  const message = page.getByTestId("hire-message");

  // When the owner ticks Blank on the 0.5.0 Mac, then picks the 0.4.0 Mac
  await blank.check();
  await page.getByTestId("hire-mac").selectOption("m-mid");

  // Then Blank is greyed and unticked with the reason, the message box is open again and Hire needs a message
  await expect(blank).toBeDisabled();
  await expect(blank).not.toBeChecked();
  await expect(page.getByTestId("hire-blank-note")).toHaveText(
    "Update this Mac's agent to hire with no first message.",
  );
  await expect(message).toBeEnabled();
  await expect(page.getByTestId("hire-submit")).toBeDisabled();

  // When the owner writes a message and hires
  await message.fill("Fix the login bug");
  await page.getByTestId("hire-submit").click();

  // Then the order carries that message
  await expect.poll(async () => (await readCommands()).length).toBe(1);
  const [order] = await readCommands();
  expect(order).toMatchObject({
    machineId: "m-mid",
    folder: "/work/mid",
    firstMessage: "Fix the login bug",
  });

  // And back on the 0.5.0 Mac, Blank can be ticked again with no note
  await page
    .getByTestId("hire-dialog")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByTestId("hire-button").click();
  await page.getByTestId("hire-mac").selectOption("m-up");
  await expect(blank).toBeEnabled();
  await expect(page.getByTestId("hire-blank-note")).toHaveCount(0);
});

test("the dialog warns that a hire will wait at the Mac when the chosen folder is not trusted, and not for a trusted or unjudged one", async ({
  context,
  page,
}) => {
  // Given three folders on the online Mac: refused, trusted and unjudged
  await withE2eDb(async (db) => {
    await seedFolders(db.collection("folders"), [
      { machineId: "m-up", path: "/work/app", existsOnMac: true },
      {
        machineId: "m-up",
        path: "/work/refused",
        existsOnMac: true,
        cliTrusted: false,
      },
      {
        machineId: "m-up",
        path: "/work/trusted",
        existsOnMac: true,
        cliTrusted: true,
      },
    ]);
  });
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  await page.getByTestId("hire-button").click();

  // When the owner picks the refused folder
  await page.getByTestId("hire-folder").selectOption("/work/refused");

  // Then the dialog warns that the hire will wait at the Mac
  await expect(page.getByTestId("hire-trust-warning")).toContainText(
    "will wait at the Mac for you to trust this folder",
  );

  // And the trusted folder and the unjudged one show no warning
  await page.getByTestId("hire-folder").selectOption("/work/trusted");
  await expect(page.getByTestId("hire-trust-warning")).toHaveCount(0);
  await page.getByTestId("hire-folder").selectOption("/work/app");
  await expect(page.getByTestId("hire-trust-warning")).toHaveCount(0);
});

test("a hire waiting at the Mac sits in Needs permission and lights the company's badge, a starting one counts as Idle, and the details card says what each waits for", async ({
  context,
  page,
}) => {
  // Given one waiting and one starting hire in the online Mac's company
  await withE2eDb(async (db) => {
    await seedSessions(db.collection("sessions"), [
      {
        sessionId: "s-wait",
        machineId: "m-up",
        machineName: "Up Mac",
        cwd: "/work/app",
        startCwd: "/work/app",
        state: "needsPermission",
        deskName: "Fix the login bug",
        kept: "hired",
        waitingAtMac: true,
      },
      {
        sessionId: "s-start",
        machineId: "m-up",
        machineName: "Up Mac",
        cwd: "/work/app",
        startCwd: "/work/app",
        state: "idle",
        deskName: "Write the docs",
        kept: "hired",
        starting: true,
      },
    ]);
  });
  await signInAsOwner(context);

  // When the owner opens the office
  await page.goto("/");
  await waitForEmployees(page, 2);

  // Then the company counts one needing permission with a badge, and one idle
  const company = page.getByTestId("company-tab").first();
  await expect(company.getByLabel("1 needs permission")).toBeVisible();
  await expect(company.getByLabel("1 idle")).toBeVisible();
  await expect(company.getByTestId("company-badge")).toHaveText("1");

  // And selecting the waiting employee says what to do at the Mac, with no Remote Control line
  await clickEmployee(page, await employeeLabelled(page, "Fix the login bug"));
  const panel = page.getByTestId("details-panel");
  await expect(panel.getByTestId("state-pill")).toHaveText(
    "Waiting at the Mac",
  );
  await expect(panel.getByTestId("launch-note")).toContainText(
    "trust the folder",
  );
  await expect(panel).not.toContainText("Remote Control");

  // And the starting employee reads Starting
  await clickEmployee(page, await employeeLabelled(page, "Write the docs"));
  await expect(panel.getByTestId("state-pill")).toHaveText("Starting");
  await expect(panel.getByTestId("launch-note")).toHaveText(
    "Starting on the Mac.",
  );
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

test("on desktop the Hire button floats over the office, outside the strip and clear of the status, list and details panel", async ({
  context,
  page,
}) => {
  // Given the owner is on the office
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);

  // Then the Hire button is a labelled, large-enough button that is not in the company strip
  const hire = page.getByTestId("hire-button");
  await expect(hire).toBeVisible();
  await expect(hire).toHaveText(/Hire/);
  await expect(
    page.getByTestId("company-strip").getByTestId("hire-button"),
  ).toHaveCount(0);
  const box = await hire.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);

  // And it covers neither the connection status nor the list beside the office
  expect(await overlaps(hire, page.getByTestId("last-updated"))).toBe(false);
  expect(await overlaps(hire, page.getByTestId("list-panel"))).toBe(false);

  // When an employee's details panel is open, the button is still visible and clear of it
  await clickEmployee(page, await employeeLabelled(page, "Existing desk"));
  await expect(page.getByTestId("details-panel")).toBeVisible();
  await expect(hire).toBeVisible();
  expect(await overlaps(hire, page.getByTestId("details-panel"))).toBe(false);
  await hire.click();
  await expect(page.getByTestId("hire-dialog")).toBeVisible();
});
