import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { clickEmployee, signInAsOwner } from "./helpers";

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
    state: "waiting",
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

    // Then only the quiet Mac's employee carries the offline mark
    await expect(page.getByTestId("agent-overlay")).toHaveCount(2);
    const down = page
      .getByTestId("agent-overlay")
      .filter({ hasText: "Down Mac / down" });
    const up = page
      .getByTestId("agent-overlay")
      .filter({ hasText: "Up Mac / up" });
    await expect(down).toHaveAttribute("data-offline", "true");
    await expect(up).not.toHaveAttribute("data-offline", "true");

    const downId = Number(await down.getAttribute("data-agent-id"));
    // And the scene draws that employee grey while the other stays in colour
    const upId = Number(await up.getAttribute("data-agent-id"));
    const drawnGrey = await page.evaluate(() =>
      Object.fromEntries(
        (window.__officeTestHooks?.getCharacters() ?? []).map((c) => [
          c.id,
          c.macOffline,
        ]),
      ),
    );
    expect(drawnGrey[downId]).toBe(true);
    expect(drawnGrey[upId]).toBe(false);

    // And its details say the Mac is offline
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
