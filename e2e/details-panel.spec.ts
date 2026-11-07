import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { MongoClient } from "mongodb";
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
