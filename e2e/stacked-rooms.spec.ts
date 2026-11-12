import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  bottomOf,
  keepOneCompany,
  overlaps,
  seedOnlineMachine,
  signInAsOwner,
  withE2eDb,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// The "phone" project's device profile applies: 393 x 852, dpr 3, touch.

/** Sessions of one Mac, one entry per [id, state, deskName]. */
async function seed(
  sessions: Collection,
  rows: Array<[string, string, string]>,
) {
  await seedOnlineMachine("m1", "Air");
  await sessions.deleteMany({});
  await sessions.insertMany(
    rows.map(([sessionId, state, deskName]) => ({
      machineId: "m1",
      machineName: "Air",
      sessionId,
      deskName,
      cwd: `/Users/q/projects/${sessionId}`,
      state,
      startedAt: new Date(),
      changedAt: new Date(),
    })),
  );
}

test.describe("the stacked rooms on a phone", () => {
  let client: MongoClient;
  let sessions: Collection;

  test.beforeEach(async ({ context }) => {
    client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
    await client.connect();
    sessions = client.db(E2E_DB).collection("sessions");
    await signInAsOwner(context);
  });
  test.afterEach(async () => {
    await sessions.deleteMany({});
    await client.close();
  });

  test("lists the employees in four stacked rooms, the rooms that need the owner first, each with its count and task names, and the tab's badge adds up the two rooms that need the owner, instead of the pixel office", async ({
    page,
  }) => {
    // Given employees in three rooms and none idle
    await seed(sessions, [
      ["p1", "needsPermission", "Fix login redirect"],
      ["w1", "waitingForYou", "Review PR comments"],
      ["w2", "waitingForYou", "Plan Q1 dashboard"],
      ["k1", "working", "Build invoice export"],
      ["k2", "thinking", "Sketch the settings page"],
    ]);

    // When the owner opens the office on a phone
    await page.goto("/");
    await expect(page.getByTestId("stacked-rooms")).toBeVisible();

    // Then the four rooms are stacked top to bottom: Needs permission, Waiting for you, Working, Idle
    const names = ["Needs permission", "Waiting for you", "Working", "Idle"];
    const tops: number[] = [];
    for (const name of names) {
      const room = page.getByRole("region", { name });
      await expect(room).toBeVisible();
      tops.push((await room.boundingBox())?.y ?? -1);
    }
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);

    // And each header shows its count, with the working and thinking employees together
    const header = (name: string) =>
      page
        .getByRole("region", { name })
        .getByRole("button", { expanded: true });
    await expect(header("Needs permission")).toContainText("1");
    await expect(header("Waiting for you")).toContainText("2");
    await expect(header("Working")).toContainText("2");

    // And the tab's badge is the sum of the two rooms that need the owner
    await expect(
      page.getByTestId("company-tab").getByTestId("company-badge"),
    ).toHaveText("3");

    // And each room shows its employees' task names, an empty room says so
    await expect(
      page
        .getByRole("region", { name: "Waiting for you" })
        .getByRole("button", { name: /Review PR comments/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Working" })
        .getByRole("button", { name: /Sketch the settings page/ }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Idle" })).toContainText(
      "Nobody here right now",
    );

    // And neither the pixel office nor the card strip is there
    await expect(page.getByTestId("office-canvas")).toHaveCount(0);
    await expect(page.getByTestId("agent-card-bar")).toHaveCount(0);
  });

  test("long Mac and task names never scroll the page sideways, and the connection status never covers a room header", async ({
    page,
  }) => {
    // Given three employees with 100-character task names on a Mac with a long name
    const longName = "x".repeat(100);
    await seed(sessions, [
      ["one", "needsPermission", `one: ${longName}`],
      ["two", "working", `two: ${longName}`],
      ["three", "idle", `three: ${longName}`],
    ]);
    await sessions.updateMany(
      {},
      { $set: { machineName: "A rather long Mac computer name" } },
    );

    // When the owner opens the office on a phone
    await page.goto("/");
    await expect(page.getByTestId("last-updated")).toBeVisible();

    // Then the rooms do not scroll sideways
    const rooms = page.getByTestId("stacked-rooms");
    expect(
      await rooms.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);

    // And each tile keeps its task inside the screen
    const tiles = page.getByRole("button", { name: /^(one|two|three):/ });
    await expect(tiles).toHaveCount(3);
    for (const box of await Promise.all(
      (await tiles.all()).map((t) => t.boundingBox()),
    )) {
      expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(393);
    }

    // And the status line covers none of the room headers
    const status = page.getByTestId("last-updated");
    for (const name of [
      "Needs permission",
      "Waiting for you",
      "Working",
      "Idle",
    ]) {
      const header = page
        .getByRole("region", { name })
        .locator("> :first-child");
      await expect(header).toBeVisible();
      expect(await overlaps(status, header)).toBe(false);
    }
  });

  test("an employee on an offline Mac is dimmed, one on an online Mac is not", async ({
    page,
  }) => {
    // Given one working employee on an online Mac
    await seed(sessions, [["k1", "working", "Build invoice export"]]);
    await page.goto("/");
    const tile = page.getByRole("button", { name: /^Build invoice export,/ });

    // Then the tile is at full strength
    await expect(tile).toHaveCSS("opacity", "1");

    // When the Mac stops reporting
    await withE2eDb((db) =>
      db
        .collection("machines")
        .updateOne(
          { machineId: "m1" },
          { $set: { lastSeenAt: new Date(Date.now() - 600_000) } },
        ),
    );

    // Then the tile is dimmed
    await expect(tile).toHaveCSS("opacity", "0.5");
  });

  test("tapping an employee's tile highlights it and opens its details sheet, tapping another moves both, and Close closes the sheet", async ({
    page,
  }) => {
    // Given one working employee and one waiting for the owner, whose room sits above the sheet
    await seed(sessions, [
      ["k1", "working", "Build invoice export"],
      ["k2", "waitingForYou", "Sketch the settings page"],
    ]);
    await page.goto("/");
    const first = page.getByRole("button", { name: /^Build invoice export,/ });
    const second = page.getByRole("button", {
      name: /^Sketch the settings page,/,
    });
    const panel = page.getByTestId("details-panel");

    // Then every tile is a tap target of at least 44 px and none is highlighted
    for (const tile of [first, second]) {
      expect((await tile.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await expect(tile).toHaveCSS("outline-style", "none");
    }

    // When the owner taps the first tile
    await first.tap();

    // Then its sheet opens with its folder, and only that tile is highlighted
    await expect(panel).toContainText("Build invoice export");
    await expect(panel).toContainText("k1");
    await expect(first).not.toHaveCSS("outline-style", "none");
    await expect(second).toHaveCSS("outline-style", "none");

    // When the owner taps the second tile
    await second.tap();

    // Then the sheet and the highlight move to it, and the page does not scroll sideways
    await expect(panel).toContainText("Sketch the settings page");
    await expect(first).toHaveCSS("outline-style", "none");
    await expect(second).not.toHaveCSS("outline-style", "none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // When the owner closes the sheet
    await panel.getByRole("button", { name: "Close" }).tap();

    // Then the sheet is gone, no tile is highlighted, and focus is back on the tile that was open
    await expect(panel).toHaveCount(0);
    await expect(second).toHaveCSS("outline-style", "none");
    await expect(second).toBeFocused();
  });

  test("tapping a room's header folds it to the header with its count and tapping again opens it, while an empty room has no button to fold", async ({
    page,
  }) => {
    // Given two working employees and nobody idle
    await seed(sessions, [
      ["k1", "working", "Build invoice export"],
      ["k2", "working", "Sketch the settings page"],
    ]);
    await page.goto("/");
    const working = page.getByRole("region", { name: "Working" });
    const header = working.getByRole("button", { name: "Working, 2" });
    const tile = working.getByRole("button", {
      name: /^Build invoice export,/,
    });
    await expect(tile).toBeVisible();

    // When the owner taps the Working header
    await header.tap();

    // Then the tiles are gone and the header still shows the count
    await expect(tile).toHaveCount(0);
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(header).toContainText("2");
    expect((await header.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    // When the owner taps it again
    await header.tap();

    // Then the tiles are back
    await expect(tile).toBeVisible();

    // And the empty Idle room has nothing to fold
    const idle = page.getByRole("region", { name: "Idle" });
    await expect(idle.getByRole("button")).toHaveCount(0);
    await expect(idle).toContainText("Nobody here right now");
  });

  test("a bottom bar stays at the screen's bottom below the rooms with Went home N and + Hire, each at least 44 px and clear of the status and each other, and + Hire opens the hire dialog", async ({
    page,
  }) => {
    // Given enough employees that the rooms scroll
    await seed(
      sessions,
      [1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string, string] => [
        `k${n}`,
        "working",
        `Task ${n}`,
      ]),
    );
    await page.goto("/");
    const bar = page.getByTestId("phone-bottom-bar");
    const hire = bar.getByRole("button", { name: "+ Hire" });
    const wentHome = bar.getByRole("button", { name: "Went home 0" });
    await expect(hire).toBeVisible();
    const viewportHeight = page.viewportSize()?.height ?? 0;

    // Then the bar ends at the bottom of the screen, and both buttons are tall enough to tap
    expect(await bottomOf(bar)).toBeCloseTo(viewportHeight, 0);
    for (const button of [hire, wentHome]) {
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect((await button.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    }

    // And the buttons overlap neither each other, nor the status, nor sit in the company strip
    expect(await overlaps(hire, wentHome)).toBe(false);
    expect(await overlaps(hire, page.getByTestId("last-updated"))).toBe(false);
    expect(await overlaps(wentHome, page.getByTestId("last-updated"))).toBe(
      false,
    );
    await expect(
      page.getByTestId("company-strip").getByTestId("hire-button"),
    ).toHaveCount(0);

    // When the owner scrolls the rooms to the end
    const rooms = page.getByTestId("stacked-rooms");
    await rooms.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    // Then the bar has not moved and the last room ends above it
    const barBox = await bar.boundingBox();
    expect(await bottomOf(bar)).toBeCloseTo(viewportHeight, 0);
    expect(
      await bottomOf(page.getByRole("region", { name: "Idle" })),
    ).toBeLessThanOrEqual(barBox?.y ?? 0);

    // When the owner taps + Hire
    await hire.tap();

    // Then the hire dialog opens
    await expect(page.getByTestId("hire-dialog")).toBeVisible();
  });

  test("the bottom bar steps aside under the details, companies and went-home sheets and is back when each closes, and Went home N opens today's list headed by the company name and newest first, whose row opens details over the list", async ({
    page,
  }) => {
    // Given a working employee and one who went home a moment ago
    await seed(sessions, [["k1", "working", "Build invoice export"]]);
    await sessions.insertOne({
      machineId: "m1",
      machineName: "Air",
      sessionId: "gone",
      deskName: "Closed task",
      cwd: "/Users/q/projects/closed",
      state: "wentHome",
      hadPrompt: true,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      changedAt: new Date(),
    });
    await page.goto("/");
    const bar = page.getByTestId("phone-bottom-bar");
    const wentHome = bar.getByRole("button", { name: "Went home 1" });
    await expect(wentHome).toBeVisible();

    // When a details sheet opens, the bar steps aside, and it is back after Close
    await page.getByRole("button", { name: /^Build invoice export,/ }).tap();
    await expect(page.getByTestId("details-panel")).toBeVisible();
    await expect(bar).toBeHidden();
    await page
      .getByTestId("details-panel")
      .getByRole("button", { name: "Close" })
      .tap();
    await expect(bar).toBeVisible();

    // When the companies sheet opens, the bar steps aside, and it is back after Close
    await page.getByTestId("open-drawer").tap();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await expect(drawer).toBeVisible();
    await expect(bar).toBeHidden();
    await drawer.getByRole("button", { name: /close/i }).tap();
    await expect(bar).toBeVisible();

    // When the owner taps Went home 1
    await wentHome.tap();

    // Then the list opens headed by the company name and newest first, with no employee count, and the bar steps aside
    const sheet = page.getByRole("dialog", { name: "Went home today" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("q · newest first");
    await expect(sheet).not.toContainText("employee");
    await expect(bar).toBeHidden();

    // When the owner taps the row, its details open over the list
    await sheet.getByRole("button", { name: /Closed task/ }).tap();
    const details = page.getByTestId("details-panel");
    await expect(details).toContainText("Closed task");
    await expect(sheet).toBeVisible();

    // When the details close, the list is still there
    await details.getByRole("button", { name: "Close" }).tap();
    await expect(details).toHaveCount(0);
    await expect(sheet).toBeVisible();

    // When the list closes, the bar is back with Went home focused
    await sheet.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(bar).toBeVisible();
    await expect(wentHome).toBeFocused();
  });

  for (const [label, size] of [
    ["upright", { width: 393, height: 852 }],
    ["sideways", { width: 852, height: 393 }],
  ] as const) {
    test(`${label}: a company tab shows its name and needs-you badge only, at least 44 px tall, and All companies is a grid icon that opens the dialog`, async ({
      page,
    }) => {
      // Given a company with a long name and employees in several rooms
      await page.setViewportSize(size);
      await seed(sessions, [
        ["p1", "needsPermission", "Fix login"],
        ["w1", "waitingForYou", "Review PR"],
        ["k1", "working", "Build export"],
      ]);
      const longFolder = `/Users/q/${"x".repeat(80)}`;
      await sessions.updateMany({}, { $set: { cwd: longFolder } });
      await withE2eDb(async (db) => {
        await db
          .collection("folders")
          .updateMany({ machineId: "m1" }, { $set: { path: longFolder } });
      });

      // When the owner opens the office on a phone
      await page.goto("/");
      const tab = page.getByTestId("company-tab");
      await expect(tab).toBeVisible();

      // Then the tab holds only the (truncated) name and the badge 2, with no counts
      await expect(tab.getByTestId("company-badge")).toHaveText("2");
      await expect(tab.getByRole("img")).toHaveCount(0);
      await expect(page.locator('[aria-label$=" working"]')).toHaveCount(0);
      const box = await tab.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      const nameIsCut = await tab
        .locator("span.truncate")
        .evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(nameIsCut).toBe(true);

      // And All companies is an icon button, with no visible text, at least 44 px each way
      const icon = page.getByRole("button", { name: "All companies" });
      await expect(icon).toHaveText("");
      const iconBox = await icon.boundingBox();
      expect(iconBox?.height).toBeGreaterThanOrEqual(44);
      expect(iconBox?.width).toBeGreaterThanOrEqual(44);

      // When the owner taps the icon
      await icon.tap();

      // Then the companies dialog opens
      await expect(
        page.getByRole("dialog", { name: "All companies" }),
      ).toBeVisible();
    });
  }

  test.describe("sideways", () => {
    test.use({ viewport: { width: 852, height: 393 } });

    test("the bottom bar and the company strip leave the rooms room to scroll, and the bar's buttons stay tappable", async ({
      page,
    }) => {
      // Given enough employees that the rooms scroll
      await seed(
        sessions,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
          (n): [string, string, string] => [`k${n}`, "working", `Task ${n}`],
        ),
      );

      // When the owner opens the office on a phone held sideways
      await page.goto("/");
      const bar = page.getByTestId("phone-bottom-bar");
      await expect(bar).toBeVisible();

      // Then both bar buttons are at least 44 px tall and the bar ends at the screen's bottom
      for (const name of ["+ Hire", "Went home 0"]) {
        const box = await bar.getByRole("button", { name }).boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      const barBox = await bar.boundingBox();
      expect(await bottomOf(bar)).toBeCloseTo(393, 0);

      // And scrolled to the end, the last room ends above the bar, and the rooms start below the company strip
      const rooms = page.getByTestId("stacked-rooms");
      await rooms.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      expect(
        await bottomOf(page.getByRole("region", { name: "Idle" })),
      ).toBeLessThanOrEqual(barBox?.y ?? 0);
      expect((await rooms.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(
        await bottomOf(page.getByTestId("company-strip")),
      );
    });

    test("a room row holds more than three tiles", async ({ page }) => {
      // Given six working employees
      await seed(
        sessions,
        [1, 2, 3, 4, 5, 6].map((n): [string, string, string] => [
          `k${n}`,
          "working",
          `Task ${n}`,
        ]),
      );

      // When the owner opens the office on a phone held sideways
      await page.goto("/");
      const tiles = page.getByRole("button", { name: /^Task \d, Working$/ });
      await expect(tiles).toHaveCount(6);

      // Then the first row holds more than three tiles
      const tops = await Promise.all(
        (await tiles.all()).map(async (t) => (await t.boundingBox())?.y),
      );
      expect(tops.filter((y) => y === tops[0]).length).toBeGreaterThan(3);
    });
  });
});
