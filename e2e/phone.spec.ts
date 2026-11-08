import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { employeeLabelled, signInAsOwner, waitForEmployees } from "./helpers";

// The "phone" project's device profile applies: 393 x 852, dpr 3, touch.

const LONG_NAME =
  "Refactor the invoicing pipeline so that late payments are retried with exponential backoff and reported";

/** Three sessions on one Mac, each with a very long desk name and folder. */
async function seed(sessions: Collection) {
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

  test("fits the screen with long names, shows the whole office, and lists every session in the card bar", async ({
    page,
  }) => {
    // When the owner opens the office on a phone
    await openOffice(page);

    // Then nothing scrolls sideways
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // And the whole office is on screen: its opposite corners are both inside the canvas
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

    // And the card bar has one card per session, each with its desk name
    const cards = page.getByTestId("agent-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("one:");
  });

  test("hangs each room sign on its wall row without covering a seat, or the employee on it, in the room's first desk row", async ({
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
    await page.getByTestId("agent-card").filter({ hasText: "two:" }).tap();

    // Then the details panel shows that session's desk name and folder
    await expect(panel).toContainText(`two: ${LONG_NAME}`);
    await expect(panel).toContainText(
      "a-really-long-folder-name-for-session-two",
    );

    // When the owner taps the third card
    await page.getByTestId("agent-card").filter({ hasText: "three:" }).tap();

    // Then the panel switches to it, and the page still does not scroll sideways
    await expect(panel).toContainText(`three: ${LONG_NAME}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a one-finger drag pans the office and keeps the camera from jumping back to the selected employee", async ({
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

  test("pinching with two fingers zooms the office in, and pinching back zooms it out", async ({
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

  test("tapping an employee on the canvas opens its details at once", async ({
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

  test("keeps the went-home list folded until it is tapped, so it does not cover the office", async ({
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

    // Then the list is folded to its title
    await expect(page.getByText("Went home today")).toBeVisible();
    await expect(entry).toBeHidden();

    // When the owner taps the title
    await page.getByText("Went home today").tap();

    // Then the departure is listed, and tapping it opens its details
    await expect(entry).toBeVisible();
    await entry.tap();
    await expect(page.getByTestId("details-panel")).toContainText(
      "Closed task",
    );
  });
});
