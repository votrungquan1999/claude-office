import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { signInAsOwner } from "./helpers";

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

/** Where an employee is on screen right now, through the renderer's own zoom and pan. */
function screenPointOf(page: Page, id: number) {
  return page.evaluate((employeeId) => {
    const hooks = window.__officeTestHooks;
    const employee = hooks?.getCharacters().find((ch) => ch.id === employeeId);
    const canvas = document.querySelector('[data-testid="office-canvas"]');
    const at =
      employee && hooks?.getTileCenter(employee.tileCol, employee.tileRow);
    if (!at || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    const x = box.x + at.x;
    const y = box.y + at.y;
    return { x, y, onCanvas: document.elementFromPoint(x, y) === canvas };
  }, id);
}

/** Clicks the employee with this renderer id at its seat, as a real mouse click on the canvas. */
async function clickEmployee(page: Page, id: number): Promise<void> {
  // The camera glides to a selected employee; click once it has stopped.
  let point = await screenPointOf(page, id);
  await expect
    .poll(async () => {
      const next = await screenPointOf(page, id);
      const still =
        Math.abs((next?.x ?? 0) - (point?.x ?? 1e9)) < 0.5 &&
        Math.abs((next?.y ?? 0) - (point?.y ?? 1e9)) < 0.5;
      point = next;
      return still;
    })
    .toBe(true);
  if (!point?.onCanvas)
    throw new Error(
      `employee ${id} is not clickable: ${JSON.stringify(point)}`,
    );
  await page.mouse.click(point.x, point.y);
}

function bubbleOf(page: Page, id: number) {
  return page.evaluate(
    (employeeId) =>
      window.__officeTestHooks
        ?.getCharacters()
        .find((ch) => ch.id === employeeId)?.bubbleType,
    id,
  );
}

test("clicking an employee opens its details with a Remote Control link, or says Remote Control is off", async ({
  context,
  page,
}) => {
  // Given three sessions (one waiting with Remote Control, one waiting without, one needing permission)
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  const base = { machineName: "Studio Mac", startedAt: new Date() };
  await sessions.insertMany([
    {
      ...base,
      machineId: "m1",
      sessionId: "s1",
      deskName: "Light the lantern",
      cwd: "/Users/q/projects/lantern",
      state: "waiting",
      bridgeSessionId: "cse_abc",
      changedAt: new Date(1000),
    },
    {
      ...base,
      machineId: "m1",
      sessionId: "s2",
      cwd: "/Users/q/projects/anvil",
      state: "waiting",
      changedAt: new Date(2000),
    },
    {
      ...base,
      machineId: "m1",
      sessionId: "s3",
      cwd: "/Users/q/projects/kiln",
      state: "needsPermission",
      bridgeSessionId: "cse_def",
      changedAt: new Date(3000),
    },
  ]);
  await signInAsOwner(context);
  // No real network for the Remote Control page.
  await context.route("https://claude.ai/**", (route) =>
    route.fulfill({ body: "remote control" }),
  );

  try {
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(3);
    const panel = page.getByTestId("details-panel");
    const startUrl = page.url();

    // When the owner clicks the first employee
    await clickEmployee(page, 1);

    // Then the details show its machine and folder, with a link that opens Remote Control in a new tab
    await expect(panel).toContainText("Light the lantern");
    await expect(panel).toContainText("Studio Mac");
    await expect(panel).toContainText("/Users/q/projects/lantern");
    const link = panel.getByTestId("remote-control-link");
    await expect(link).toHaveAttribute(
      "href",
      "https://claude.ai/code/cse_abc",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    expect(page.url()).toBe(startUrl);

    // When the owner clicks one without Remote Control
    await clickEmployee(page, 2);

    // Then the details say so and offer no link
    await expect(panel).toContainText("/Users/q/projects/anvil");
    await expect(panel).toContainText("Remote Control is off for this session");
    await expect(panel.getByTestId("remote-control-link")).toHaveCount(0);

    // When the owner clicks the one needing permission
    expect(await bubbleOf(page, 3)).toBe("permission");
    await clickEmployee(page, 3);
    await expect(panel.getByTestId("remote-control-link")).toHaveAttribute(
      "href",
      "https://claude.ai/code/cse_def",
    );

    // Then its details show and the permission bubble is still showing
    await expect(panel).toContainText("/Users/q/projects/kiln");
    expect(await bubbleOf(page, 3)).toBe("permission");

    // When the owner closes the details
    await panel.getByRole("button", { name: "Close" }).click();

    // Then they are gone
    await expect(panel).toHaveCount(0);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});

test("the details list the last 5 steps with durations, the running step and the to-do line, and 'Show more' loads older steps", async ({
  context,
  page,
}) => {
  // Given a session with 8 stored steps, its newest 5 on the session, one running step and a to-do line
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const db = client.db(E2E_DB);
  const sessions = db.collection("sessions");
  const steps = db.collection("steps");
  await sessions.deleteMany({});
  await steps.deleteMany({});
  // Relative to now so the steps stay inside the 7-day visibility window.
  const t0 = Date.now() - 3_600_000;
  const stored = Array.from({ length: 8 }, (_, i) => ({
    _id: new ObjectId(),
    machineId: "m1",
    sessionId: "s1",
    text: `Step ${i + 1}`,
    startedAt: new Date(t0 + i * 1000),
    durationMs: i === 7 ? 4500 : 100,
    status: i === 6 ? "failed" : "ok",
    expireAt: new Date(t0 + 7 * 86_400_000),
  }));
  await steps.insertMany(stored);
  await sessions.insertOne({
    machineId: "m1",
    machineName: "Studio Mac",
    sessionId: "s1",
    cwd: "/Users/q/projects/lantern",
    state: "working",
    startedAt: new Date(t0),
    currentTodo: "Fixing login",
    runningSteps: [{ text: "Read live.ts", startedAt: new Date(t0 + 9000) }],
    recentSteps: stored.slice(3).map(({ _id, ...step }) => ({
      id: _id.toHexString(),
      ...step,
    })),
    changedAt: new Date(1000),
  });
  await signInAsOwner(context);

  try {
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(1);

    // When the owner opens the employee's details
    await clickEmployee(page, 1);
    const panel = page.getByTestId("details-panel");
    const list = panel.getByTestId("steps-list");

    // Then the to-do line, the running step and the last 5 steps with run times show, oldest of them first
    await expect(panel.getByTestId("current-todo")).toHaveText("Fixing login");
    await expect(list.getByRole("listitem")).toHaveText([
      "Step 4 · 100 ms",
      "Step 5 · 100 ms",
      "Step 6 · 100 ms",
      "Step 7 · 100 ms · failed",
      "Step 8 · 4.5 s",
      "Read live.ts · running",
    ]);

    // When the owner asks for more
    await panel.getByRole("button", { name: "Show more" }).click();

    // Then the 3 older steps appear above, and there is nothing more to ask for
    await expect(list.getByRole("listitem")).toHaveText([
      "Step 1 · 100 ms",
      "Step 2 · 100 ms",
      "Step 3 · 100 ms",
      "Step 4 · 100 ms",
      "Step 5 · 100 ms",
      "Step 6 · 100 ms",
      "Step 7 · 100 ms · failed",
      "Step 8 · 4.5 s",
      "Read live.ts · running",
    ]);
    await expect(panel.getByRole("button", { name: "Show more" })).toHaveCount(
      0,
    );
  } finally {
    await sessions.deleteMany({});
    await steps.deleteMany({});
    await client.close();
  }
});

test.describe("on a short screen", () => {
  test.use({ viewport: { width: 1000, height: 400 } });

  test("a long details panel stays on screen and scrolls to its Remote Control link", async ({
    context,
    page,
  }) => {
    // Given a session with 14 stored steps and Remote Control
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await db.collection("sessions").deleteMany({});
    await db.collection("steps").deleteMany({});
    // Relative to now so the steps stay inside the 7-day visibility window.
    const t0 = Date.now() - 3_600_000;
    const stored = Array.from({ length: 14 }, (_, i) => ({
      _id: new ObjectId(),
      machineId: "m1",
      sessionId: "s1",
      text: `Step ${i + 1}`,
      startedAt: new Date(t0 + i * 1000),
      durationMs: 100,
      status: "ok",
      expireAt: new Date(t0 + 7 * 86_400_000),
    }));
    await db.collection("steps").insertMany(stored);
    await db.collection("sessions").insertOne({
      machineId: "m1",
      machineName: "Studio Mac",
      sessionId: "s1",
      cwd: "/Users/q/projects/lantern",
      state: "waiting",
      startedAt: new Date(t0),
      bridgeSessionId: "cse_abc",
      recentSteps: stored.slice(9).map(({ _id, ...step }) => ({
        id: _id.toHexString(),
        ...step,
      })),
      changedAt: new Date(1000),
    });
    await signInAsOwner(context);

    try {
      await page.goto("/");
      await expect
        .poll(() =>
          page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
        )
        .toBe(1);

      // When the owner opens the details and loads the older steps
      await clickEmployee(page, 1);
      const panel = page.getByTestId("details-panel");
      await panel.getByRole("button", { name: "Show more" }).click();
      await expect(panel.getByRole("listitem")).toHaveCount(14);

      // Then the panel fits inside the screen and scrolls, and the link can be scrolled to
      const box = await panel.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(400);
      expect(
        await panel.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      const link = panel.getByTestId("remote-control-link");
      await link.scrollIntoViewIfNeeded();
      const linkBox = await link.boundingBox();
      expect((linkBox?.y ?? 0) + (linkBox?.height ?? 0)).toBeLessThanOrEqual(
        400,
      );
    } finally {
      await db.collection("sessions").deleteMany({});
      await db.collection("steps").deleteMany({});
      await client.close();
    }
  });
});
