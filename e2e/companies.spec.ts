import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
} from "./helpers";

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
    { machineId: "air", path: "/Users/q/retired" },
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
    session("air", "old", "/Users/q/retired", "wentHome", {
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

test("clicking a company tab shows only that company's employees, went-home list and phone cards, and the first company is shown to begin with", async ({
  context,
  page,
}) => {
  // Given two companies: personal with two live sessions and a departure, workspace with one live session and a departure
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const db = client.db(E2E_DB);
  const now = Date.now();
  await db.collection("machines").deleteMany({});
  await db.collection("machines").insertOne({
    machineId: "air",
    machineName: "Air",
    lastSeenAt: new Date(now),
  });
  await seedFolders(db.collection("folders"), [
    { machineId: "air", path: "/Users/q/personal" },
    { machineId: "air", path: "/Users/q/ubet/workspace" },
  ]);
  const row = (
    sessionId: string,
    cwd: string,
    state: string,
    extra: Record<string, unknown> = {},
  ) => ({
    machineId: "air",
    machineName: "Air",
    sessionId,
    cwd,
    startCwd: cwd,
    state,
    deskName: sessionId,
    startedAt: new Date(now - 2 * HOUR),
    changedAt: new Date(now - 60_000),
    ...extra,
  });
  const gone = { hadPrompt: true, endedAt: new Date(now - 60_000) };
  const sessions = db.collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany([
    row("p1", "/Users/q/personal/a", "idle"),
    row("p2", "/Users/q/personal/b", "idle"),
    row("pgone", "/Users/q/personal/c", "wentHome", gone),
    row("w1", "/Users/q/ubet/workspace", "idle"),
    row("wgone", "/Users/q/ubet/workspace/d", "wentHome", gone),
  ]);
  await signInAsOwner(context);
  const employees = () =>
    page.evaluate(() => window.__officeTestHooks?.getCharacters().length);
  const departures = () =>
    page.getByTestId("went-home-list").locator("li").allTextContents();

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then the first company by name, personal, is shown with its two employees, cards and its departure only
    await expect.poll(employees).toBe(2);
    await expect(page.getByTestId("agent-card")).toHaveCount(2);
    await expect.poll(async () => (await departures()).length).toBe(1);
    expect((await departures())[0]).toContain("pgone");
    await expect(
      page.locator('[data-company-name="personal"]'),
    ).toHaveAttribute("aria-current", "page");

    // When the owner opens a personal employee's details and then clicks the workspace tab
    await page.getByTestId("agent-card").first().click();
    await expect(page.getByTestId("details-panel")).toBeVisible();
    await page.locator('[data-company-name="workspace"]').click();

    // Then the panel closes, and only workspace's employee, card and departure remain
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    // The switch is immediate, not waiting for the next poll
    await expect.poll(employees, { timeout: 500 }).toBe(1);
    await expect(page.getByTestId("agent-card")).toHaveCount(1);
    await expect.poll(async () => (await departures())[0]).toContain("wgone");
    expect(await departures()).toHaveLength(1);

    // And the pick survives the next poll answer
    await page.waitForResponse((response) =>
      response.url().includes("/api/office/changes"),
    );
    expect(await employees()).toBe(1);
    await expect(
      page.locator('[data-company-name="workspace"]'),
    ).toHaveAttribute("aria-current", "page");

    // And the choice survives a reload
    await page.reload();
    await expect.poll(employees).toBe(1);
    await expect(
      page.locator('[data-company-name="workspace"]'),
    ).toHaveAttribute("aria-current", "page");
  } finally {
    await seedFolders(db.collection("folders"), []);
    await db.collection("machines").deleteMany({});
    await sessions.deleteMany({});
    await client.close();
  }
});

test("the drawer lists every Mac and company with four counts, greys the offline Mac, picks a company, and closes with Escape returning focus to its button", async ({
  context,
  page,
}) => {
  // Given an online Mac with a company that has nothing live, and an offline Mac with one session needing permission
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
    { machineId: "air", path: "/Users/q/workspace" },
    { machineId: "air", path: "/Users/q/unused" },
    { machineId: "mini", path: "/Users/q/lab" },
  ]);
  const row = (
    machineId: string,
    sessionId: string,
    cwd: string,
    state: string,
  ) => ({
    machineId,
    machineName: machineId === "air" ? "Air" : "Mini",
    sessionId,
    cwd,
    startCwd: cwd,
    state,
    deskName: sessionId,
    startedAt: new Date(now - 2 * HOUR),
    changedAt: new Date(now - 60_000),
  });
  const sessions = db.collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany([
    row("air", "p1", "/Users/q/personal/a", "idle"),
    row("air", "w1", "/Users/q/workspace", "needsPermission"),
    row("air", "w2", "/Users/q/workspace/x", "idle"),
    row("mini", "l1", "/Users/q/lab", "needsPermission"),
  ]);
  await signInAsOwner(context);
  const employees = () =>
    page.evaluate(() => window.__officeTestHooks?.getCharacters().length);

  try {
    // Given the office is open on personal with a session's details showing
    await page.goto("/");
    await expect.poll(employees).toBe(1);
    await page.getByTestId("agent-card").first().click();
    await expect(page.getByTestId("details-panel")).toBeVisible();

    // When the owner opens the drawer
    const trigger = page.getByTestId("open-drawer");
    await trigger.click();

    // Then the details close and the dialog lists every company, including the unused one with zeros
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    const unused = drawer.getByTestId("drawer-company-unused");
    await expect(unused.getByLabel("0 working")).toBeVisible();
    await expect(unused.getByLabel("0 idle")).toBeVisible();

    // And the offline Mac is greyed with its four counts, and the header counts what waits elsewhere
    const mini = drawer.getByTestId("drawer-mac-mini");
    await expect(mini).toHaveAttribute("data-offline", "true");
    await expect(mini.getByLabel("1 needs permission")).toBeVisible();
    await expect(drawer.getByTestId("elsewhere-need-you")).toHaveText(
      "1 elsewhere need you",
    );

    // When the owner picks workspace
    await drawer
      .getByTestId("drawer-company-workspace")
      .getByRole("button", { name: /^workspace/ })
      .click();

    // Then the drawer closes and the office shows workspace, with focus back on the trigger
    await expect(drawer).toHaveCount(0);
    await expect(
      page.locator('[data-company-name="workspace"]'),
    ).toHaveAttribute("aria-current", "page");
    // Workspace has two employees against personal's one, so the office really switched
    await expect.poll(employees).toBe(2);
    await expect(trigger).toBeFocused();

    // When the owner reopens it and presses Escape
    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");

    // Then it closes and focus returns to the trigger
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await seedFolders(db.collection("folders"), []);
    await db.collection("machines").deleteMany({});
    await sessions.deleteMany({});
    await client.close();
  }
});

test.describe("many companies", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("All companies stays at the bar's right edge while the company tabs scroll", async ({
    context,
    page,
  }) => {
    // Given one Mac with eight companies, more tabs than the bar is wide
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    const names = [
      "alpha-harbor",
      "bravo-orchard",
      "charlie-foundry",
      "delta-lantern",
      "echo-meadow",
      "foxtrot-quarry",
      "golf-station",
      "hotel-workshop",
    ];
    await seedFolders(
      db.collection("folders"),
      names.map((name) => ({ machineId: "air", path: `/Users/q/${name}` })),
    );
    await seedOnlineMachine("air", "Air");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      names.map((name) => ({
        machineId: "air",
        machineName: "Air",
        sessionId: name,
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);

    try {
      // When the owner opens the office
      await page.goto("/");
      await expect(page.getByTestId("company-tab")).toHaveCount(8);

      // Then the tabs overflow their own scroller, not the page
      const tabs = page.getByTestId("company-tabs");
      const overflow = await tabs.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(overflow.scroll).toBeGreaterThan(overflow.client);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.body.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      // And All companies sits fully on screen at the bar's right edge
      const button = page.getByTestId("open-drawer");
      const before = await button.boundingBox();
      const width = await page.evaluate(() => window.innerWidth);
      if (!before) throw new Error("the All companies button has no box");
      expect(before.x + before.width).toBeLessThanOrEqual(width);

      // When the owner scrolls the tabs to their end
      await tabs.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });

      // Then the button has not moved and still opens the drawer
      expect(await button.boundingBox()).toEqual(before);
      await button.click();
      await expect(
        page.getByRole("dialog", { name: "All companies" }),
      ).toBeVisible();
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });
});

test.describe("folding a Mac", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("pressing a Mac's name folds its tabs into one label and pressing it again opens them, without changing the viewed company", async ({
    context,
    page,
  }) => {
    // Given two Macs, Air with two companies (the first is viewed) and Mini with one
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha" },
      { machineId: "air", path: "/Users/q/bravo" },
      { machineId: "mini", path: "/Users/q/lab" },
    ]);
    await seedOnlineMachine("air", "Air");
    await seedOnlineMachine("mini", "Mini");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      [
        ["air", "Air", "alpha"],
        ["air", "Air", "bravo"],
        ["mini", "Mini", "lab"],
      ].map(([machineId, machineName, name]) => ({
        machineId,
        machineName,
        sessionId: name,
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);

    try {
      await page.goto("/");
      const tabs = page.getByTestId("company-tab");
      await expect(tabs).toHaveCount(3);
      const toggle = page.getByTestId("mac-toggle-mini");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      // When the owner folds Mini
      await toggle.click();

      // Then Mini's tab is gone, its label counts it, and the viewed company is the same
      await expect(tabs).toHaveCount(2);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText("Mini · 1 company");
      await expect(page.locator('[data-company-name="alpha"]')).toHaveAttribute(
        "aria-current",
        "page",
      );

      // When the owner opens it again
      await toggle.click();

      // Then the tab is back
      await expect(tabs).toHaveCount(3);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });

  test("a folded Mac is still folded after a reload in the same browser", async ({
    context,
    page,
  }) => {
    // Given two Macs with live companies, the first company viewed
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha" },
      { machineId: "air", path: "/Users/q/bravo" },
      { machineId: "mini", path: "/Users/q/lab" },
    ]);
    await seedOnlineMachine("air", "Air");
    await seedOnlineMachine("mini", "Mini");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      [
        ["air", "Air", "alpha"],
        ["air", "Air", "bravo"],
        ["mini", "Mini", "lab"],
      ].map(([machineId, machineName, name]) => ({
        machineId,
        machineName,
        sessionId: name,
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);

    try {
      await page.goto("/");
      const tabs = page.getByTestId("company-tab");
      await expect(tabs).toHaveCount(3);

      // When the owner folds Mini and reloads
      await page.getByTestId("mac-toggle-mini").click();
      await expect(tabs).toHaveCount(2);
      await page.reload();

      // Then Mini is still folded and Air is still open
      await expect(page.getByTestId("mac-toggle-mini")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(page.getByTestId("mac-toggle-air")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(tabs).toHaveCount(2);
      await expect(page.locator('[data-company-name="lab"]')).toHaveCount(0);
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });
});
