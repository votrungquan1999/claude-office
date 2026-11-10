import { expect, test } from "@playwright/test";
import {
  clearCommands,
  clickEmployee,
  employeeLabelled,
  readCommands,
  seedFolders,
  seedSessions,
  signInAsOwner,
  updateCommand,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

/** Seeds an online Mac with a kept running employee and a plain one, plus an offline Mac and an out-of-date one that each have a kept employee. */
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
      { machineId: "m-up", path: "/work/up" },
      { machineId: "m-down", path: "/work/down" },
      { machineId: "m-old", path: "/work/old" },
    ]);
    const kept = (machineId: string, machineName: string, path: string) => ({
      sessionId: `s-${machineId}`,
      machineId,
      machineName,
      cwd: path,
      startCwd: path,
      kept: "hired" as const,
      deskName: `Kept on ${machineName}`,
    });
    await seedSessions(db.collection("sessions"), [
      kept("m-up", "Up Mac", "/work/up"),
      {
        sessionId: "s-plain",
        machineId: "m-up",
        machineName: "Up Mac",
        cwd: "/work/up",
        startCwd: "/work/up",
        deskName: "Plain desk",
      },
      kept("m-down", "Down Mac", "/work/down"),
      kept("m-old", "Old Mac", "/work/old"),
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

test("Dismiss is offered for a kept employee and not a plain one, sends one order, and keeps the outcome while the employee is reselected", async ({
  context,
  page,
}) => {
  // Given the office on the online Mac's company
  await signInAsOwner(context);
  await page.goto("/");
  await page.locator('[data-company-name="up"]').click();
  await waitForEmployees(page, 2);
  const panel = page.getByTestId("details-panel");

  // When the owner selects the plain employee
  await clickEmployee(page, await employeeLabelled(page, "Plain desk"));

  // Then there is no Dismiss button
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
    "Plain desk",
  );
  await expect(panel.getByTestId("dismiss-button")).toHaveCount(0);

  // When the owner selects the kept employee
  await clickEmployee(page, await employeeLabelled(page, "Kept on Up Mac"));

  // Then Dismiss is offered
  await expect(panel.getByTestId("dismiss-button")).toBeEnabled();

  // When the owner clicks Dismiss
  await panel.getByTestId("dismiss-button").click();

  // Then exactly one dismiss order for that Mac and session exists, and the button is disabled while it is pending
  await expect.poll(async () => (await readCommands()).length).toBe(1);
  const [order] = await readCommands();
  expect(order).toMatchObject({
    kind: "dismiss",
    machineId: "m-up",
    sessionId: "s-m-up",
    status: "pending",
  });
  await expect(panel.getByTestId("dismiss-button")).toBeDisabled();

  // When the Mac reports it could not do it
  await updateCommand(order._id, { status: "failed", reason: "interrupted" });

  // Then the card says so
  await expect(panel.getByTestId("dismiss-outcome")).toContainText(
    "Not dismissed",
  );

  // When the owner selects another employee and then this one again
  await clickEmployee(page, await employeeLabelled(page, "Plain desk"));
  await expect(panel.getByTestId("dismiss-button")).toHaveCount(0);
  await clickEmployee(page, await employeeLabelled(page, "Kept on Up Mac"));

  // Then the outcome is still there
  await expect(panel.getByTestId("dismiss-outcome")).toContainText(
    "Not dismissed",
  );
});

test("Dismiss is disabled for an offline Mac, and for an out-of-date agent with the update text", async ({
  context,
  page,
}) => {
  // Given the office with an offline Mac and an out-of-date one
  await signInAsOwner(context);
  await page.goto("/");
  await waitForEmployees(page, 1);
  const panel = page.getByTestId("details-panel");

  // When the owner selects the kept employee of the offline Mac
  await page.locator('[data-company-name="down"]').click();
  await clickEmployee(page, await employeeLabelled(page, "Kept on Down Mac"));

  // Then Dismiss is disabled
  await expect(panel.getByTestId("dismiss-button")).toBeDisabled();

  // When the owner selects the kept employee of the out-of-date Mac
  await page.locator('[data-company-name="old"]').click();
  await clickEmployee(page, await employeeLabelled(page, "Kept on Old Mac"));

  // Then Dismiss is disabled and the card says to update the agent
  await expect(panel.getByTestId("dismiss-button")).toBeDisabled();
  await expect(panel.getByTestId("dismiss-note")).toContainText(
    "Update this Mac's agent",
  );
});
