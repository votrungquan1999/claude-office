import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
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

  test.describe("sideways", () => {
    test.use({ viewport: { width: 852, height: 393 } });

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
