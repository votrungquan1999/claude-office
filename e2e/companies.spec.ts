import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { seedFolders, signInAsOwner } from "./helpers";

const HOUR = 3_600_000;

test("the company strip shows each Mac's active companies with four counts and a badge, greys the offline Mac, and leaves out a company that only went home before today", async ({
  context,
  page,
}) => {
  // Given two Macs (the Mini is offline) with folders, sessions in every live state, one went home today and one only yesterday
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const db = client.db(E2E_DB);
  const now = Date.now();
  await db.collection("machines").deleteMany({});
  await db.collection("machines").insertMany([
    { machineId: "air", machineName: "Air", lastSeenAt: new Date(now) },
    {
      machineId: "mini",
      machineName: "Mini",
      lastSeenAt: new Date(now - 600_000),
    },
  ]);
  await seedFolders(db.collection("folders"), [
    { machineId: "air", path: "/Users/q/personal" },
    { machineId: "air", path: "/Users/q/ubet-devenv/workspace" },
    { machineId: "air", path: "/Users/q/old" },
    { machineId: "mini", path: "/Users/q/lab" },
  ]);
  const session = (
    machineId: string,
    sessionId: string,
    cwd: string,
    state: string,
    extra: Record<string, unknown> = {},
  ) => ({
    machineId,
    machineName: machineId === "air" ? "Air" : "Mini",
    sessionId,
    cwd,
    startCwd: cwd,
    state,
    startedAt: new Date(now - 2 * HOUR),
    changedAt: new Date(now - 60_000),
    ...extra,
  });
  const home = "/Users/q/personal";
  const sessions = db.collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany([
    session("air", "w", `${home}/claude-office`, "working"),
    session("air", "t", `${home}/claude-office`, "thinking"),
    session("air", "f", `${home}/other-app`, "waitingForYou"),
    session("air", "i", home, "idle"),
    session("air", "p", "/Users/q/ubet-devenv/workspace", "needsPermission"),
    session("air", "gone", "/Users/q/ubet-devenv/workspace", "wentHome", {
      hadPrompt: true,
      endedAt: new Date(now - 60_000),
    }),
    session("air", "old", "/Users/q/old", "wentHome", {
      hadPrompt: true,
      endedAt: new Date(now - 30 * HOUR),
    }),
    session("mini", "m", "/Users/q/lab", "needsPermission"),
  ]);
  await signInAsOwner(context);

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then the strip lists the three active companies and not the one that went home yesterday
    const tabs = page.getByTestId("company-tab");
    await expect(tabs).toHaveCount(3);
    await expect(
      tabs.evaluateAll((all) =>
        all.map((t) => t.getAttribute("data-company-name")),
      ),
    ).resolves.toEqual(["personal", "workspace", "lab"]);

    // And personal counts Thinking as Working and shows a badge for the one waiting for the owner
    const personal = page.locator('[data-company-name="personal"]');
    await expect(personal.getByLabel("2 working")).toBeVisible();
    await expect(personal.getByLabel("0 needs permission")).toBeVisible();
    await expect(personal.getByLabel("1 waiting for you")).toBeVisible();
    await expect(personal.getByLabel("1 idle")).toBeVisible();
    await expect(personal.getByTestId("company-badge")).toHaveText("1");

    // And the company with a departure today keeps its live count, with a badge for the permission request
    const workspace = page.locator('[data-company-name="workspace"]');
    await expect(workspace.getByLabel("1 needs permission")).toBeVisible();
    await expect(workspace.getByTestId("company-badge")).toHaveText("1");

    // And the offline Mac is greyed with its count but no badge
    const mini = page.getByTestId("mac-group-mini");
    await expect(mini).toHaveAttribute("data-offline", "true");
    await expect(mini.getByLabel("1 needs permission")).toBeVisible();
    await expect(mini.getByTestId("company-badge")).toHaveCount(0);
  } finally {
    await seedFolders(db.collection("folders"), []);
    await db.collection("machines").deleteMany({});
    await sessions.deleteMany({});
    await client.close();
  }
});
