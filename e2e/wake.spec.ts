import { expect, test } from "@playwright/test";
import {
  clearCommands,
  clickEmployee,
  employeeLabelled,
  openWentHome,
  readCommands,
  seedFolders,
  seedSessions,
  signInAsOwner,
  updateCommand,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

/** Seeds an online Mac with a went-home and a running employee, plus an offline Mac and an out-of-date one that each have a went-home employee. */
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
      { machineId: "m-up", path: "/work/up", cliTrusted: false },
      { machineId: "m-down", path: "/work/down" },
      { machineId: "m-old", path: "/work/old" },
    ]);
    const home = (machineId: string, machineName: string, path: string) => ({
      sessionId: `s-${machineId}`,
      machineId,
      machineName,
      cwd: path,
      startCwd: path,
      state: "wentHome",
      deskName: `Home on ${machineName}`,
      hadPrompt: true,
      endedAt: new Date(now - 60_000),
    });
    await seedSessions(db.collection("sessions"), [
      home("m-up", "Up Mac", "/work/up"),
      {
        sessionId: "s-running",
        machineId: "m-up",
        machineName: "Up Mac",
        cwd: "/work/up",
        startCwd: "/work/up",
        deskName: "Running desk",
      },
      home("m-down", "Down Mac", "/work/down"),
      home("m-old", "Old Mac", "/work/old"),
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

test("Wake is offered for a went-home employee and not a running one, sends one order, warns about an untrusted folder, and keeps the outcome while the employee is reselected", async ({
  context,
  page,
}) => {
  // Given the office on the online Mac's company
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  const panel = page.getByTestId("details-panel");

  // When the owner selects the running employee
  await clickEmployee(page, await employeeLabelled(page, "Running desk"));

  // Then there is no Wake button
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
    "Running desk",
  );
  await expect(panel.getByTestId("wake-button")).toHaveCount(0);

  // When the owner opens the went-home employee from the list
  const list = await openWentHome(page);
  const entry = list
    .getByRole("listitem")
    .filter({ hasText: "Home on Up Mac" });
  await entry.click();

  // Then Wake is offered with the untrusted-folder warning
  await expect(panel.getByTestId("wake-button")).toBeEnabled();
  await expect(panel.getByTestId("wake-trust-warning")).toContainText(
    "will wait at the Mac for you to trust this folder",
  );

  // When the owner clicks Wake
  await panel.getByTestId("wake-button").click();

  // Then exactly one wake order for that Mac and session exists, and the button is disabled while it is pending
  await expect.poll(async () => (await readCommands()).length).toBe(1);
  const [order] = await readCommands();
  expect(order).toMatchObject({
    kind: "wake",
    machineId: "m-up",
    sessionId: "s-m-up",
    folder: "/work/up",
    status: "pending",
  });
  await expect(panel.getByTestId("wake-button")).toBeDisabled();

  // When the Mac reports the conversation is open elsewhere
  await updateCommand(order._id, {
    status: "failed",
    reason: "openElsewhere",
  });

  // Then the card says so
  await expect(panel.getByTestId("wake-outcome")).toHaveText(
    "Not woken: open elsewhere.",
  );

  // When the owner selects another employee and then this one again
  await clickEmployee(page, await employeeLabelled(page, "Running desk"));
  await expect(panel.getByTestId("wake-button")).toHaveCount(0);
  await entry.click();

  // Then the outcome is still there
  await expect(panel.getByTestId("wake-outcome")).toHaveText(
    "Not woken: open elsewhere.",
  );
});

test("Wake is disabled for an offline Mac, and for an out-of-date agent with the update text", async ({
  context,
  page,
}) => {
  // Given the office with an offline Mac and an out-of-date one
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  const panel = page.getByTestId("details-panel");

  // When the owner opens the went-home employee of the offline Mac
  await page.locator('[data-company-name="down"]').click();
  await (await openWentHome(page))
    .getByRole("listitem")
    .filter({ hasText: "Home on Down Mac" })
    .click();

  // Then Wake is disabled
  await expect(panel.getByTestId("wake-button")).toBeDisabled();

  // When the owner opens the went-home employee of the out-of-date Mac
  await page.locator('[data-company-name="old"]').click();
  await (await openWentHome(page))
    .getByRole("listitem")
    .filter({ hasText: "Home on Old Mac" })
    .click();

  // Then Wake is disabled and the card says to update the agent
  await expect(panel.getByTestId("wake-button")).toBeDisabled();
  await expect(panel.getByTestId("wake-note")).toContainText(
    "Update this Mac's agent",
  );
});
