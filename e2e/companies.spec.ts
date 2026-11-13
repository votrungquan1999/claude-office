import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  openWentHome,
  overlaps,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
  withE2eDb,
} from "./helpers";

const HOUR = 3_600_000;

/** The employee tiles of the stacked rooms, not the room headers. */
const roomTiles = (page: Page) =>
  page.getByTestId("stacked-rooms").getByRole("button", {
    name: /, (Needs permission|Waiting for you|Working|Idle)$/,
  });

test.describe("on a desktop", () => {
  // Reads the tab's five labelled counts at a fixed desktop size.
  test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

  test("the company strip shows each Mac's active companies with five counts and a badge that includes Review, greys the offline Mac, and leaves out a company that only went home before today", async ({
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
      session("air", "r", `${home}/other-app`, "review"),
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
      session("mini", "mr", "/Users/q/lab", "review"),
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

      // And personal counts Thinking as Working and shows a badge for the one waiting and the one in Review
      const personal = page.locator('[data-company-name="personal"]');
      await expect(personal.getByLabel("2 working")).toBeVisible();
      await expect(personal.getByLabel("0 needs permission")).toBeVisible();
      await expect(personal.getByLabel("1 waiting for you")).toBeVisible();
      await expect(personal.getByLabel("1 review")).toBeVisible();
      await expect(personal.getByLabel("1 idle")).toBeVisible();
      await expect(personal.getByTestId("company-badge")).toHaveText("2");

      // And the company with a departure today keeps its live count, with a badge for the permission request
      const workspace = page.locator('[data-company-name="workspace"]');
      await expect(workspace.getByLabel("1 needs permission")).toBeVisible();
      await expect(workspace.getByTestId("company-badge")).toHaveText("1");

      // And the offline Mac is greyed with its count but no badge
      const mini = page.getByTestId("mac-group-mini");
      await expect(mini).toHaveAttribute("data-offline", "true");
      await expect(mini.getByLabel("1 needs permission")).toBeVisible();
      await expect(mini.getByLabel("1 review")).toBeVisible();
      await expect(mini.getByTestId("company-badge")).toHaveCount(0);
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });
});

test("the browser tab title counts the employees that need you in every company on an online Mac, and is the plain name when nobody does", async ({
  context,
  page,
}) => {
  // Given a permission, a waiting and a review in two companies of an online Mac, a permission on an offline Mac, and a working and a went-home employee
  await withE2eDb(async (db) => {
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/personal" },
      { machineId: "air", path: "/Users/q/work" },
      { machineId: "mini", path: "/Users/q/lab" },
    ]);
    await db.collection("machines").deleteMany({});
    await seedOnlineMachine("air", "Air");
    await db.collection("machines").insertOne({
      machineId: "mini",
      machineName: "Mini",
      lastSeenAt: new Date(Date.now() - 600_000),
    });
    await seedSessions(db.collection("sessions"), [
      {
        sessionId: "p",
        machineId: "air",
        cwd: "/Users/q/personal/a",
        startCwd: "/Users/q/personal/a",
        state: "needsPermission",
      },
      {
        sessionId: "w",
        machineId: "air",
        cwd: "/Users/q/work/b",
        startCwd: "/Users/q/work/b",
        state: "waitingForYou",
      },
      {
        sessionId: "r",
        machineId: "air",
        cwd: "/Users/q/work/c",
        startCwd: "/Users/q/work/c",
        state: "review",
      },
      {
        sessionId: "busy",
        machineId: "air",
        cwd: "/Users/q/work/d",
        startCwd: "/Users/q/work/d",
        state: "working",
      },
      {
        sessionId: "gone",
        machineId: "air",
        cwd: "/Users/q/work/e",
        startCwd: "/Users/q/work/e",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(),
      },
      {
        sessionId: "off",
        machineId: "mini",
        cwd: "/Users/q/lab/f",
        startCwd: "/Users/q/lab/f",
        state: "needsPermission",
      },
    ]);
  });
  await signInAsOwner(context);

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then the title counts the three on the online Mac, the viewed company or not
    await expect(page).toHaveTitle("(3) Claude Office");

    // When nobody needs the owner any more
    await withE2eDb(async (db) => {
      await db
        .collection("sessions")
        .updateMany({}, { $set: { state: "idle", changedAt: new Date() } });
    });

    // Then the title is the plain name
    await expect(page).toHaveTitle("Claude Office");
  } finally {
    await withE2eDb(async (db) => {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await db.collection("sessions").deleteMany({});
    });
  }
});

test("clicking a company tab shows only that company's employees, went-home list and room tiles, and the first company is shown to begin with", async ({
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
    // When the owner opens the office and its went-home drawer
    await page.goto("/");
    await openWentHome(page);

    // Then the first company by name, personal, is shown with its two employees, cards and its departure only
    await expect.poll(employees).toBe(2);
    await expect(roomTiles(page)).toHaveCount(2);
    await expect.poll(async () => (await departures()).length).toBe(1);
    expect((await departures())[0]).toContain("pgone");
    await expect(
      page.locator('[data-company-name="personal"]'),
    ).toHaveAttribute("aria-current", "page");

    // When the owner closes the list, opens a personal employee's details and then clicks the workspace tab
    await page
      .getByTestId("went-home-drawer")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await roomTiles(page).first().click();
    await expect(page.getByTestId("details-panel")).toBeVisible();
    await page.locator('[data-company-name="workspace"]').click();

    // Then the panel closes, and only workspace's employee, card and departure remain
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    // The switch is immediate, not waiting for the next poll
    await expect.poll(employees, { timeout: 500 }).toBe(1);
    await expect(roomTiles(page)).toHaveCount(1);
    await openWentHome(page);
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

test("the drawer lists every Mac and company with five counts, greys the offline Mac, picks a company, and closes with Escape returning focus to its button", async ({
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
    row("air", "w3", "/Users/q/workspace/x", "review"),
    row("mini", "l1", "/Users/q/lab", "needsPermission"),
    row("mini", "l2", "/Users/q/lab", "review"),
  ]);
  await signInAsOwner(context);
  const employees = () =>
    page.evaluate(() => window.__officeTestHooks?.getCharacters().length);

  try {
    // Given the office is open on personal with a session's details showing
    await page.goto("/");
    await expect.poll(employees).toBe(1);
    await roomTiles(page).first().click();
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
    await expect(unused.getByLabel("0 review")).toBeVisible();
    await expect(unused.getByLabel("0 idle")).toBeVisible();

    // And the offline Mac is greyed with its five counts, and the header counts what waits elsewhere, Review included
    const mini = drawer.getByTestId("drawer-mac-mini");
    await expect(mini).toHaveAttribute("data-offline", "true");
    await expect(mini.getByLabel("1 needs permission")).toBeVisible();
    await expect(mini.getByLabel("1 review")).toBeVisible();
    await expect(drawer.getByTestId("elsewhere-need-you")).toHaveText(
      "2 elsewhere need you",
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
    // Workspace has three employees against personal's one, so the office really switched
    await expect.poll(employees).toBe(3);
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

test.describe("the companies drawer on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  /** One online Mac with one company of the given name and one live employee. */
  async function seedOneCompany(displayName?: string) {
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha", displayName },
    ]);
    await seedOnlineMachine("air", "Air");
    await seedSessions(db.collection("sessions"), [
      {
        sessionId: "alpha",
        machineId: "air",
        machineName: "Air",
        cwd: "/Users/q/alpha",
        startCwd: "/Users/q/alpha",
      },
    ]);
    return {
      async cleanup() {
        await seedFolders(db.collection("folders"), []);
        await db.collection("machines").deleteMany({});
        await db.collection("sessions").deleteMany({});
        await client.close();
      },
    };
  }

  test("a 100-character name and its folder line show in full inside the drawer row, wrapped", async ({
    context,
    page,
  }) => {
    // Given a company named with 100 characters
    const long = "N".repeat(100);
    const seeded = await seedOneCompany(long);
    await signInAsOwner(context);

    try {
      // When the owner opens All companies
      await page.goto("/");
      await page.getByTestId("open-drawer").click();

      // Then the name wraps onto several lines and nothing is clipped
      const row = page.getByTestId(`drawer-company-${long}`);
      const name = row.getByText(long, { exact: true });
      await expect(name).toBeVisible();
      const box = await name.boundingBox();
      expect(box?.height).toBeGreaterThan(30);
      const clipped = await name.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(clipped).toBe(false);
      const rowBox = await row.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
      );
    } finally {
      await seeded.cleanup();
    }
  });

  test("the drawer leaves the Connection lost message visible instead of covering it", async ({
    context,
    page,
  }) => {
    // Given an office that loaded and then lost its connection
    const seeded = await seedOneCompany();
    await signInAsOwner(context);

    try {
      await page.goto("/");
      await expect(page.getByTestId("company-tab")).toBeVisible();
      await page.route("**/api/office/changes*", (route) => route.abort());
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "Connection lost" });
      await expect(alert).toBeVisible({ timeout: 15_000 });

      // When the owner opens All companies
      await page.getByTestId("open-drawer").click();
      const drawer = page.getByRole("dialog", { name: "All companies" });
      await expect(drawer).toBeVisible();

      // Then the message is still visible and beside the drawer, not under it
      await expect(alert).toBeVisible();
      expect(await overlaps(alert, drawer)).toBe(false);
      const box = await alert.boundingBox();
      const drawerBox = await drawer.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        drawerBox?.x ?? 0,
      );
    } finally {
      await seeded.cleanup();
    }
  });

  test.describe("on a touch tablet", () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

    test("the sheet leaves the Connection lost message visible instead of covering it", async ({
      context,
      page,
    }) => {
      // Given an office that loaded and then lost its connection
      const seeded = await seedOneCompany();
      await signInAsOwner(context);

      try {
        await page.goto("/");
        await expect(page.getByTestId("company-tab")).toBeVisible();
        await page.route("**/api/office/changes*", (route) => route.abort());
        const alert = page
          .getByRole("alert")
          .filter({ hasText: "Connection lost" });
        await expect(alert).toBeVisible({ timeout: 15_000 });

        // When the owner opens All companies
        await page.getByTestId("open-drawer").tap();
        const sheet = page.getByRole("dialog", { name: "All companies" });
        await expect(sheet).toBeVisible();

        // Then the message is still visible and clear of the sheet
        await expect(alert).toBeVisible();
        expect(await overlaps(alert, sheet)).toBe(false);
      } finally {
        await seeded.cleanup();
      }
    });
  });
});
