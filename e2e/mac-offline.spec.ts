import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  clickEmployee,
  employeeLabelled,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

test("employees of a Mac that stopped sending heartbeats are marked offline, and the others are not", async ({
  context,
  page,
}) => {
  // Given two Macs, one seen a moment ago and one ten minutes ago, each with one session
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const db = client.db(E2E_DB);
  await db.collection("sessions").deleteMany({});
  await db.collection("machines").deleteMany({});
  const now = Date.now();
  await db.collection("machines").insertMany([
    { machineId: "m-up", machineName: "Up Mac", lastSeenAt: new Date(now) },
    {
      machineId: "m-down",
      machineName: "Down Mac",
      lastSeenAt: new Date(now - 600_000),
    },
  ]);
  const base = {
    startedAt: new Date(),
    state: "idle",
    changedAt: new Date(),
  };
  await db.collection("sessions").insertMany([
    {
      ...base,
      machineId: "m-up",
      machineName: "Up Mac",
      sessionId: "s-up",
      cwd: "/work/up",
    },
    {
      ...base,
      machineId: "m-down",
      machineName: "Down Mac",
      sessionId: "s-down",
      cwd: "/work/down",
    },
  ]);
  await signInAsOwner(context);

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then the online Mac's company is shown first, and its employee carries no offline mark
    await waitForEmployees(page, 1);
    const upId = await employeeLabelled(page, "Up Mac / up");
    const labelOf = (id: number) =>
      page.locator(`[data-testid="agent-overlay"][data-agent-id="${id}"]`);
    await page.evaluate((i) => window.__officeTestHooks?.selectAgent(i), upId);
    await expect(labelOf(upId)).not.toHaveAttribute("data-offline", "true");
    const drawn = () =>
      page.evaluate(() =>
        (window.__officeTestHooks?.getCharacters() ?? []).map(
          (c) => c.macOffline,
        ),
      );
    expect(await drawn()).toEqual([false]);

    // When the owner opens the quiet Mac's company
    await page.locator('[data-company-name="down"]').click();

    // Then its employee carries the offline mark and is drawn grey
    await waitForEmployees(page, 1);
    const downId = await employeeLabelled(page, "Down Mac / down");
    await page.evaluate(
      (i) => window.__officeTestHooks?.selectAgent(i),
      downId,
    );
    await expect(labelOf(downId)).toHaveAttribute("data-offline", "true");
    expect(await drawn()).toEqual([true]);

    // And its details say the Mac is offline
    await page.evaluate(() => window.__officeTestHooks?.selectAgent(-1));
    await clickEmployee(page, downId);
    await expect(page.getByTestId("details-panel")).toContainText(
      "Mac offline",
    );
  } finally {
    await db.collection("sessions").deleteMany({});
    await db.collection("machines").deleteMany({});
    await client.close();
  }
});
