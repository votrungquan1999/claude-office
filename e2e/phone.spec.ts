import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  employeeLabelled,
  keepOneCompany,
  overlaps,
  seedOnlineMachine,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// The "phone" project's device profile applies: 393 x 852, dpr 3, touch.

const LONG_NAME =
  "Refactor the invoicing pipeline so that late payments are retried with exponential backoff and reported";

/** Three sessions on one Mac, each with a very long desk name and folder. */
async function seed(sessions: Collection) {
  await seedOnlineMachine("m1", "A rather long Mac computer name");
  await sessions.deleteMany({});
  const base = {
    machineId: "m1",
    machineName: "A rather long Mac computer name",
    startedAt: new Date(),
    state: "working",
    changedAt: new Date(),
  };
  await sessions.insertMany(
    ["one", "two", "three"].map((id) => ({
      ...base,
      sessionId: id,
      deskName: `${id}: ${LONG_NAME}`,
      cwd: `/Users/q/projects/a-really-long-folder-name-for-session-${id}`,
    })),
  );
}

interface Point {
  x: number;
  y: number;
}

/**
 * Sends one or two fingers across the office canvas as the TouchEvents a phone produces; Playwright's
 * touchscreen can only tap. Both fingers land at `from`, move in steps to `to`, and lift.
 */
async function fingerGesture(page: Page, from: Point[], to: Point[]) {
  await page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector('[data-testid="office-canvas"]');
      if (!canvas) throw new Error("no office canvas");
      const box = canvas.getBoundingClientRect();
      const touches = (points: Point[]) =>
        points.map(
          (p, i) =>
            new Touch({
              identifier: i + 1,
              target: canvas,
              clientX: box.x + p.x,
              clientY: box.y + p.y,
            }),
        );
      const fire = (type: string, down: Touch[], changed: Touch[]) =>
        canvas.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: down,
            targetTouches: down,
            changedTouches: changed,
          }),
        );
      const first = touches(from);
      fire("touchstart", [first[0]], [first[0]]);
      if (first.length > 1) fire("touchstart", first, [first[1]]);
      const steps = 8;
      let last = first;
      for (let i = 1; i <= steps; i++) {
        last = touches(
          from.map((f, k) => ({
            x: f.x + ((to[k].x - f.x) * i) / steps,
            y: f.y + ((to[k].y - f.y) * i) / steps,
          })),
        );
        fire("touchmove", last, last);
      }
      if (last.length > 1) {
        fire("touchend", [last[0]], [last[1]]);
        fire("touchend", [], [last[0]]);
      } else {
        fire("touchend", [], [last[0]]);
      }
    },
    { from, to },
  );
}

const zoomOf = (page: Page) =>
  page.evaluate(() => window.__officeTestHooks?.getZoom() ?? 0);

const panOf = (page: Page) =>
  page.evaluate(() => window.__officeTestHooks?.getPan());

async function openOffice(page: Page) {
  await page.goto("/");
  await waitForEmployees(page, 3);
}

/** Makes session "one" a busy permission request: Remote Control, a project below the company folder, four tags, a running step and five finished steps. */
async function makeCardBusy(sessions: Collection) {
  await sessions.updateOne(
    { sessionId: "one" },
    {
      $set: {
        state: "needsPermission",
        bridgeSessionId: "cse_abc",
        startCwd: "/Users/q/projects/a-really-long-folder-name-for-session-one",
        tags: ["alpha", "bravo", "charlie", "delta"].map((name) => ({
          name,
          key: `key-${name}`,
        })),
        runningSteps: [
          { text: "Run the whole e2e suite", startedAt: new Date() },
        ],
        recentSteps: Array.from({ length: 5 }, (_, i) => ({
          id: `step-${i}`,
          machineId: "m1",
          sessionId: "one",
          text: `Finished step ${i + 1}`,
          startedAt: new Date(Date.now() - (i + 1) * 60_000),
          durationMs: 100,
          status: "ok",
          expireAt: new Date(Date.now() + 86_400_000),
        })),
      },
    },
  );
}

/**
 * Opens the busy employee's tile on a phone and checks the sheet sits inside the screen with its button in view.
 * @param page - The office page.
 * @param sideways - True on a short screen, where the sheet scrolls as a whole and every step is reachable.
 */
async function expectSheetFits(page: Page, sideways = false) {
  await page.getByRole("button", { name: /^one:/ }).tap();
  const panel = page.getByTestId("details-panel");
  await expect(panel.getByTestId("wants-to-run")).toBeVisible();
  const screen = page.viewportSize();
  const box = await panel.boundingBox();
  const button = await panel.getByTestId("remote-control-link").boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    screen?.height ?? 0,
  );
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(button?.y ?? -1).toBeGreaterThanOrEqual(box?.y ?? 0);
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0),
  );
  if (sideways) {
    // The sheet scrolls as a whole, and each of the five steps can be scrolled to and read at full height
    expect(
      await panel.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    const rows = panel.getByTestId("step-text");
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      const sheetBox = await panel.boundingBox();
      expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(10);
      expect(rowBox?.y ?? 0).toBeGreaterThanOrEqual(sheetBox?.y ?? 0);
      // Scrolling snaps to device pixels (1/3 px at dpr 3), so a row can end a fraction past the edge.
      expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual(
        (sheetBox?.y ?? 0) + (sheetBox?.height ?? 0) + 0.5,
      );
    }
  } else {
    // The steps list keeps some height
    const list = await panel.getByTestId("steps-list").boundingBox();
    expect(list?.height ?? 0).toBeGreaterThan(0);
  }
  // And "More steps" stays above the footer
  const more = await panel
    .getByRole("button", { name: "More steps" })
    .boundingBox();
  const footer = await panel.getByTestId("folder").boundingBox();
  expect((more?.y ?? 0) + (more?.height ?? 0)).toBeLessThanOrEqual(
    footer?.y ?? 0,
  );
}

test.describe("the office on a phone", () => {
  let client: MongoClient;
  let sessions: Collection;

  test.beforeEach(async ({ context }) => {
    client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
    await client.connect();
    sessions = client.db(E2E_DB).collection("sessions");
    await seed(sessions);
    await signInAsOwner(context);
  });
  test.afterEach(async () => {
    await sessions.deleteMany({});
    await client.close();
  });

  test("the details sheet of a busy permission request fits upright with its button in view", async ({
    page,
  }) => {
    // Given a session with Remote Control, a project, four tags and a running step
    await makeCardBusy(sessions);
    await openOffice(page);

    // Then its sheet fits the screen and shows the button
    await expectSheetFits(page);
  });

  test("the Hire button floats over the canvas upright, outside the strip and clear of the status and went-home list, and opens the dialog", async ({
    page,
  }) => {
    // When the owner opens the office upright
    await openOffice(page);

    // Then the Hire button is visible, at least 44px tall, and not in the strip
    const hire = page.getByTestId("hire-button");
    await expect(hire).toBeVisible();
    expect((await hire.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByTestId("company-strip").getByTestId("hire-button"),
    ).toHaveCount(0);

    // And it overlaps neither the connection status nor the went-home button
    expect(await overlaps(hire, page.getByTestId("last-updated"))).toBe(false);
    expect(await overlaps(hire, page.getByTestId("went-home-button"))).toBe(
      false,
    );

    // When the owner taps it
    await hire.tap();

    // Then the hire dialog opens
    await expect(page.getByTestId("hire-dialog")).toBeVisible();
  });

  test("the Hire button steps aside while the details sheet or the company drawer is open", async ({
    page,
  }) => {
    // Given the office upright with the Hire button showing
    await openOffice(page);
    const hire = page.getByTestId("hire-button");
    await expect(hire).toBeVisible();

    // When the company drawer opens, the button is hidden so it does not cover the sheet
    await page.getByTestId("open-drawer").tap();
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await expect(drawer).toBeVisible();
    await expect(hire).toBeHidden();

    // When it closes and a details sheet opens, the button stays hidden
    await drawer.getByRole("button", { name: /close/i }).tap();
    await expect(hire).toBeVisible();
    await page.getByRole("button", { name: /^one:/ }).tap();
    await expect(page.getByTestId("details-panel")).toBeVisible();
    await expect(hire).toBeHidden();
  });

  test("the Remote Control link on the phone has no target, so iOS can open the Claude app, and keeps the same address", async ({
    page,
  }) => {
    // Given the office on a phone with a session that has Remote Control
    await makeCardBusy(sessions);
    await openOffice(page);

    // When the owner opens the session's details sheet
    await page.getByRole("button", { name: /^one:/ }).tap();
    const link = page
      .getByTestId("details-panel")
      .getByTestId("remote-control-link");

    // Then the link goes to the session's claude.ai/code page and has no target
    await expect(link).toHaveAttribute(
      "href",
      /^https:\/\/claude\.ai\/code\/\S+$/,
    );
    await expect(link).not.toHaveAttribute("target");
  });

  test("fits the screen with long names and lists every session as a tile", async ({
    page,
  }) => {
    // When the owner opens the office on a phone
    await openOffice(page);

    // Then the rooms do not scroll sideways
    const rooms = page.getByTestId("stacked-rooms");
    expect(
      await rooms.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);

    // And every session has a tile with its desk name
    const tiles = page.getByRole("button", { name: /^(one|two|three):/ });
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first()).toContainText("one:");
  });

  // Parked until the canvas tests run at a 1024x768 touch viewport.
  test.fixme("shows the whole office: its opposite corners are both inside the canvas", async ({
    page,
  }) => {
    await openOffice(page);
    const corners = await page.evaluate(() => {
      const hooks = window.__officeTestHooks;
      const size = hooks?.getLayoutSize();
      const box = document
        .querySelector('[data-testid="office-canvas"]')
        ?.getBoundingClientRect();
      if (!hooks || !size || !box) return null;
      const first = hooks.getTileCenter(0, 0);
      const last = hooks.getTileCenter(size.cols - 1, size.rows - 1);
      return { first, last, width: box.width, height: box.height };
    });
    expect(corners?.first?.x).toBeGreaterThanOrEqual(0);
    expect(corners?.first?.y).toBeGreaterThanOrEqual(0);
    expect(corners?.last?.x).toBeLessThanOrEqual(corners?.width ?? 0);
    expect(corners?.last?.y).toBeLessThanOrEqual(corners?.height ?? 0);
  });

  // Parked until the canvas tests run at a 1024x768 touch viewport.
  test.fixme("hangs each room sign on its wall row without covering a seat, or the employee on it, in the room's first desk row", async ({
    page,
  }) => {
    // When the owner opens the office on a phone
    await openOffice(page);

    // Then no sign overlaps a seat tile of its room's first desk row or the employee standing there
    const overlaps = await page.evaluate(() => {
      const hooks = window.__officeTestHooks;
      const canvas = document
        .querySelector('[data-testid="office-canvas"]')
        ?.getBoundingClientRect();
      if (!hooks || !canvas) throw new Error("no office hooks");
      const tilePx = (16 * hooks.getZoom()) / window.devicePixelRatio;
      const seats = hooks.getSeats();
      const hits: string[] = [];
      const signs = [...document.querySelectorAll('[data-testid="room-sign"]')];
      for (const sign of signs) {
        const room = (sign as HTMLElement).dataset.room ?? "";
        const box = sign.getBoundingClientRect();
        const roomSeats = seats.filter((seat) => seat.areaLabel === room);
        const firstRow = Math.min(...roomSeats.map((seat) => seat.row));
        for (const seat of roomSeats.filter((s) => s.row === firstRow)) {
          const center = hooks.getTileCenter(seat.col, seat.row);
          if (!center) continue;
          const left = canvas.x + center.x - tilePx / 2;
          // The employee standing on the seat (and a speech bubble above) reaches two tiles up
          const top = canvas.y + center.y - tilePx / 2 - 2 * tilePx;
          const overlap =
            box.left < left + tilePx &&
            box.right > left &&
            box.top < top + 3 * tilePx &&
            box.bottom > top;
          if (overlap) hits.push(`${room} seat ${seat.col},${seat.row}`);
        }
      }
      return { hits, signs: signs.length };
    });
    expect(overlaps.signs).toBe(4);
    expect(overlaps.hits).toEqual([]);
  });

  test("tapping a card opens that session's details, and tapping another switches to it", async ({
    page,
  }) => {
    // Given the office on a phone with three sessions
    await openOffice(page);
    const panel = page.getByTestId("details-panel");
    await expect(panel).toHaveCount(0);

    // When the owner taps the second card
    await page.getByRole("button", { name: /^two:/ }).tap();

    // Then the details panel shows that session's desk name and folder
    await expect(panel).toContainText(`two: ${LONG_NAME}`);
    await expect(panel).toContainText(
      "a-really-long-folder-name-for-session-two",
    );

    // When the owner taps the third card
    await page.getByRole("button", { name: /^three:/ }).tap();

    // Then the panel switches to it, and the page still does not scroll sideways
    await expect(panel).toContainText(`three: ${LONG_NAME}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test.fixme("a one-finger drag pans the office and keeps the camera from jumping back to the selected employee", async ({
    page,
  }) => {
    // Given the office with an employee selected, so the camera follows it
    await openOffice(page);
    await page.getByTestId("agent-card").filter({ hasText: "one:" }).tap();
    await expect(page.getByTestId("details-panel")).toBeVisible();
    await page.waitForTimeout(800);
    const before = await panOf(page);

    // When a finger drags across an empty part of the canvas
    await fingerGesture(page, [{ x: 100, y: 200 }], [{ x: 60, y: 150 }]);
    const dragged = await panOf(page);

    // Then the pan moved with the finger
    expect(dragged?.x).not.toBe(before?.x);
    expect(dragged?.y).not.toBe(before?.y);

    // And it stays where the finger left it
    await page.waitForTimeout(800);
    expect(await panOf(page)).toEqual(dragged);
  });

  test.fixme("pinching with two fingers zooms the office in, and pinching back zooms it out", async ({
    page,
  }) => {
    // Given the office at its fit-to-screen zoom
    await openOffice(page);
    const fitted = await zoomOf(page);

    // When two fingers spread apart on the canvas
    await fingerGesture(
      page,
      [
        { x: 150, y: 300 },
        { x: 190, y: 300 },
      ],
      [
        { x: 60, y: 300 },
        { x: 280, y: 300 },
      ],
    );

    // Then the zoom is higher
    const zoomedIn = await zoomOf(page);
    expect(zoomedIn).toBeGreaterThan(fitted);

    // When they pinch back together
    await fingerGesture(
      page,
      [
        { x: 60, y: 300 },
        { x: 280, y: 300 },
      ],
      [
        { x: 150, y: 300 },
        { x: 170, y: 300 },
      ],
    );

    // Then the zoom is lower again
    expect(await zoomOf(page)).toBeLessThan(zoomedIn);
  });

  test.fixme("tapping an employee on the canvas opens its details at once", async ({
    page,
  }) => {
    // Given the office on a phone, and where the employee of the second session stands
    await openOffice(page);
    const id = await employeeLabelled(page, "two:");
    const point = await page.evaluate((employeeId) => {
      const hooks = window.__officeTestHooks;
      const employee = hooks
        ?.getCharacters()
        .find((ch) => ch.id === employeeId);
      const box = document
        .querySelector('[data-testid="office-canvas"]')
        ?.getBoundingClientRect();
      const at =
        employee && hooks?.getTileCenter(employee.tileCol, employee.tileRow);
      return at && box ? { x: box.x + at.x, y: box.y + at.y } : null;
    }, id);
    expect(point).not.toBeNull();

    // When a finger taps them once
    await page.touchscreen.tap(point?.x ?? 0, point?.y ?? 0);

    // Then the details of that session are open, with no second tap
    await expect(page.getByTestId("details-panel")).toContainText(
      `two: ${LONG_NAME}`,
    );
  });

  test("keeps the went-home list behind its button until it is tapped, so it does not cover the office", async ({
    page,
  }) => {
    // Given a session that ended a moment ago
    await sessions.insertOne({
      machineId: "m1",
      machineName: "Mac",
      sessionId: "gone",
      deskName: "Closed task",
      cwd: "/Users/q/projects/closed",
      state: "wentHome",
      hadPrompt: true,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      changedAt: new Date(),
    });

    // When the owner opens the office on a phone
    await openOffice(page);
    const entry = page.getByRole("button", { name: /Closed task/ });

    // Then only the button shows, with the count
    const button = page.getByTestId("went-home-button");
    await expect(button).toHaveText(/^Went home today\s*1$/);
    await expect(entry).toBeHidden();

    // When the owner taps the button
    await button.tap();

    // Then the departure is listed, and tapping it opens its details
    await expect(entry).toBeVisible();
    await entry.tap();
    await expect(page.getByTestId("details-panel")).toContainText(
      "Closed task",
    );
  });
});

test.describe("the office on a sideways phone", () => {
  test.use({ viewport: { width: 852, height: 393 } });
  let client: MongoClient;
  let sessions: Collection;

  test.beforeEach(async ({ context }) => {
    client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
    await client.connect();
    sessions = client.db(E2E_DB).collection("sessions");
    await seed(sessions);
    await signInAsOwner(context);
  });
  test.afterEach(async () => {
    await sessions.deleteMany({});
    await client.close();
  });

  test("the details sheet of a busy permission request fits sideways with its button in view", async ({
    page,
  }) => {
    // Given a session with Remote Control, a project, four tags and a running step
    await makeCardBusy(sessions);
    await openOffice(page);

    // Then its sheet fits the screen and shows the button
    await expectSheetFits(page, true);
  });

  test("shows the same company bar and stacked rooms as upright, and its drawer opens as a sheet that survives turning the phone upright", async ({
    page,
  }) => {
    // When the owner opens the office sideways
    await openOffice(page);

    // Then the company bar shows its tabs, with no folded company button
    await expect(page.getByTestId("company-strip")).toBeVisible();
    await expect(page.getByTestId("company-tab")).toHaveCount(1);
    await expect(page.getByTestId("compact-company-button")).toHaveCount(0);

    // And the same four rooms as upright are there, and the page itself does not scroll
    for (const name of [
      "Needs permission",
      "Waiting for you",
      "Working",
      "Idle",
    ]) {
      await expect(page.getByRole("region", { name })).toHaveCount(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    ).toBeLessThanOrEqual(0);

    // When the owner opens All companies from the bar
    await page.getByTestId("open-drawer").tap();

    // Then the drawer is a sheet that leaves room above it, with its close button in reach
    const drawer = page.getByRole("dialog", { name: "All companies" });
    await expect(drawer).toBeVisible();
    const strip = await page.getByTestId("company-strip").boundingBox();
    const sheet = await drawer.boundingBox();
    const available = 393 - (strip?.height ?? 0);
    expect(sheet?.height ?? available).toBeLessThan(available - 2);
    await expect(drawer.getByRole("button", { name: /close/i })).toBeVisible();

    // When the phone is turned upright
    await page.setViewportSize({ width: 393, height: 852 });

    // Then the drawer is still open
    await expect(drawer).toBeVisible();
  });
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 700, height: 800 },
]) {
  test.describe(`the office at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });
    let client: MongoClient;
    let sessions: Collection;

    test.beforeEach(async ({ context }) => {
      client = new MongoClient(readFileSync(E2E_MONGO_URI_FILE, "utf8").trim());
      await client.connect();
      sessions = client.db(E2E_DB).collection("sessions");
      await seed(sessions);
      await signInAsOwner(context);
    });
    test.afterEach(async () => {
      await sessions.deleteMany({});
      await client.close();
    });

    test("keeps the company strip and does not fold it into a button", async ({
      page,
    }) => {
      // When the owner opens the office
      await openOffice(page);

      // Then the strip shows and no folded button replaces it
      await expect(page.getByTestId("company-strip")).toBeVisible();
      await expect(page.getByTestId("compact-company-button")).toHaveCount(0);
    });
  });
}
