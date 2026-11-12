import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  clickEmployee,
  keepOneCompany,
  openWentHome,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// Local midnight is 17:00Z the day before in this zone, so "today" is fixed whatever the host's zone is.
test.use({
  viewport: { width: 1600, height: 1200 },
  hasTouch: false,
  timezoneId: "Asia/Ho_Chi_Minh",
});

test("the went-home drawer lists today's prompted departures only, narrows the office, and opens details from a row", async ({
  context,
  page,
}) => {
  // Given a live session and three that ended: today, yesterday, and today without ever getting a prompt
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  const base = {
    machineName: "Studio Mac",
    machineId: "m1",
    startedAt: new Date("2026-11-07T01:00:00.000Z"),
  };
  const ended = (sessionId: string, endedAt: string, hadPrompt: boolean) => ({
    ...base,
    sessionId,
    cwd: `/Users/q/projects/${sessionId}`,
    state: "wentHome",
    hadPrompt,
    endedAt: new Date(endedAt),
    changedAt: new Date(endedAt),
  });
  await sessions.insertMany([
    {
      ...base,
      sessionId: "live",
      cwd: "/Users/q/projects/live",
      state: "idle",
      changedAt: new Date("2026-11-08T02:00:00.000Z"),
    },
    {
      ...ended("today", "2026-11-08T01:05:00.000Z", true),
      deskName: "Light the lantern",
      bridgeSessionId: "cse_gone",
    },
    ended("yesterday", "2026-11-07T16:00:00.000Z", true),
    ended("quiet", "2026-11-08T01:30:00.000Z", false),
  ]);
  await signInAsOwner(context);
  // It is 10:00 on Nov 8 in the browser's zone.
  await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then one employee is in the office and the button counts exactly today's departure
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(1);
    const button = page.getByTestId("went-home-button");
    await expect(button).toHaveText(/^Went home today\s*1$/);
    const hire = page.getByTestId("hire-button");
    await expect(hire).toBeVisible();
    const canvas = page.getByTestId("office-canvas");
    const widthBefore = (await canvas.boundingBox())?.width ?? 0;

    // When the owner opens the drawer
    await button.click();

    // Then it lists the departure with its full task, where it ran and when
    const drawer = page.getByRole("dialog", { name: "Went home today" });
    await expect(drawer).toContainText("q · 1 employee · newest first");
    const list = page.getByTestId("went-home-list");
    await expect(list.getByRole("listitem")).toHaveText([
      "Light the lanternStudio Mac / q/projects/today08:05",
    ]);

    // And the office is narrower and Hire is out of the way
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0)
      .toBeLessThan(widthBefore - 300);
    await expect(hire).toBeHidden();

    // When the owner clicks the row
    await list.getByRole("listitem").first().click();

    // Then the details show with no Remote Control link, and the drawer stays open
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText("Light the lantern");
    await expect(panel.getByTestId("folder")).toHaveText("~/projects/today");
    await expect(panel.getByTestId("state-pill")).toHaveText("Went home");
    await expect(panel.getByTestId("state-band")).toHaveCSS(
      "background-color",
      "rgb(90, 90, 106)",
    );
    await expect(panel).not.toContainText("Remote Control");
    await expect(panel.getByTestId("remote-control-link")).toHaveCount(0);
    await expect(drawer).toBeVisible();

    // When the owner presses Escape
    await page.keyboard.press("Escape");

    // Then the details card closes first and the drawer stays
    await expect(panel).toHaveCount(0);
    await expect(drawer).toBeVisible();

    // When the owner presses Escape again
    await page.keyboard.press("Escape");

    // Then the drawer closes, focus returns to the button, and Hire is back
    await expect(drawer).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(hire).toBeVisible();
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});

test("Escape closes the card the owner opened last, also when it came from a click on an employee in the office", async ({
  context,
  page,
}) => {
  // Given one live employee and one departure today
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany([
    {
      machineName: "Studio Mac",
      machineId: "m1",
      sessionId: "live",
      deskName: "Paint the fence",
      cwd: "/Users/q/projects/live",
      state: "idle",
      startedAt: new Date("2026-11-07T01:00:00.000Z"),
      changedAt: new Date("2026-11-08T02:00:00.000Z"),
    },
    {
      machineName: "Studio Mac",
      machineId: "m1",
      sessionId: "today",
      cwd: "/Users/q/projects/today",
      state: "wentHome",
      hadPrompt: true,
      startedAt: new Date("2026-11-07T01:00:00.000Z"),
      endedAt: new Date("2026-11-08T01:05:00.000Z"),
      changedAt: new Date("2026-11-08T01:05:00.000Z"),
    },
  ]);
  await signInAsOwner(context);
  await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

  try {
    await page.goto("/");
    await waitForEmployees(page, 1);
    await openWentHome(page);
    const drawer = page.getByTestId("went-home-drawer");

    // When the owner clicks the employee in the office
    const id = await page.evaluate(
      () => window.__officeTestHooks?.getCharacters()[0]?.id ?? -1,
    );
    await clickEmployee(page, id);
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText("Paint the fence");

    // And presses Escape
    await page.keyboard.press("Escape");

    // Then the card closes and the drawer stays
    await expect(panel).toHaveCount(0);
    await expect(drawer).toBeVisible();
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});

test("the went-home button stays at zero and the drawer says nobody has gone home when local midnight passes", async ({
  context,
  page,
}) => {
  // Given one prompted departure today, 10:00 on Nov 8 in the browser's zone
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertOne({
    machineName: "Studio Mac",
    machineId: "m1",
    sessionId: "today",
    cwd: "/Users/q/projects/today",
    state: "wentHome",
    hadPrompt: true,
    startedAt: new Date("2026-11-07T01:00:00.000Z"),
    endedAt: new Date("2026-11-08T01:05:00.000Z"),
    changedAt: new Date("2026-11-08T01:05:00.000Z"),
  });
  await signInAsOwner(context);
  await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

  try {
    await page.goto("/");
    const button = page.getByTestId("went-home-button");
    await expect(button).toHaveText(/^Went home today\s*1$/);

    // When the clock passes local midnight
    await page.clock.fastForward("14:00:00");

    // Then the button reads 0 and the drawer says nobody has gone home
    await expect(button).toHaveText(/^Went home today\s*0$/);
    const list = await openWentHome(page);
    await expect(list.getByRole("listitem")).toHaveCount(0);
    await expect(page.getByTestId("went-home-drawer")).toContainText(
      "Nobody has gone home today",
    );
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});

test("only one right drawer is open at a time: All companies closes Went home and the other way round", async ({
  context,
  page,
}) => {
  // Given one departure today
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertOne({
    machineName: "Studio Mac",
    machineId: "m1",
    sessionId: "today",
    cwd: "/Users/q/projects/today",
    state: "wentHome",
    hadPrompt: true,
    startedAt: new Date("2026-11-07T01:00:00.000Z"),
    endedAt: new Date("2026-11-08T01:05:00.000Z"),
    changedAt: new Date("2026-11-08T01:05:00.000Z"),
  });
  await signInAsOwner(context);
  await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

  try {
    await page.goto("/");
    const wentHome = page.getByRole("dialog", { name: "Went home today" });
    const companies = page.getByRole("dialog", { name: "All companies" });
    await openWentHome(page);
    await expect(wentHome).toHaveCount(1);

    // When the owner opens All companies
    await page.getByTestId("open-drawer").click();

    // Then Went home closes
    await expect(companies).toHaveCount(1);
    await expect(wentHome).toHaveCount(0);

    // When the owner opens Went home
    await page.getByTestId("went-home-button").click();

    // Then All companies closes
    await expect(wentHome).toHaveCount(1);
    await expect(companies).toHaveCount(0);

    // When the owner opens All companies and presses it again
    await page.getByTestId("open-drawer").click();
    await expect(companies).toHaveCount(1);
    await page.getByTestId("open-drawer").click();

    // Then All companies closes
    await expect(companies).toHaveCount(0);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});

test.describe("on a touch tablet", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("the went-home button opens a sheet, a tapped row opens its details over the sheet, and closing the details shows the list again", async ({
    context,
    page,
  }) => {
    // Given one departure today
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const sessions = client.db(E2E_DB).collection("sessions");
    await sessions.deleteMany({});
    await sessions.insertOne({
      machineName: "Studio Mac",
      machineId: "m1",
      sessionId: "today",
      deskName: "Light the lantern",
      cwd: "/Users/q/projects/today",
      state: "wentHome",
      hadPrompt: true,
      startedAt: new Date("2026-11-07T01:00:00.000Z"),
      endedAt: new Date("2026-11-08T01:05:00.000Z"),
      changedAt: new Date("2026-11-08T01:05:00.000Z"),
    });
    await signInAsOwner(context);
    await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

    try {
      await page.goto("/");
      const button = page.getByTestId("went-home-button");
      await expect(button).toHaveText(/^Went home today\s*1$/);

      // When the owner taps the button
      await button.tap();

      // Then a sheet lists the departure, and Hire is out of the way
      const sheet = page.getByTestId("went-home-drawer");
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId("hire-button")).toBeHidden();

      // When the owner taps the row
      await page.getByTestId("went-home-list").getByRole("listitem").tap();

      // Then the details are open over the sheet, which stays behind them
      const panel = page.getByTestId("details-panel");
      await expect(panel).toContainText("Light the lantern");
      await expect(sheet).toBeVisible();
      const panelBox = await panel.boundingBox();
      const topAtPanel = await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-testid="details-panel"]') !== null,
        {
          x: (panelBox?.x ?? 0) + (panelBox?.width ?? 0) / 2,
          y: (panelBox?.y ?? 0) + 20,
        },
      );
      expect(topAtPanel).toBe(true);

      // When the owner closes the details
      await panel.getByRole("button", { name: /close/i }).tap();

      // Then the list is showing again
      await expect(panel).toHaveCount(0);
      await expect(sheet).toBeVisible();
    } finally {
      await sessions.deleteMany({});
      await client.close();
    }
  });

  test("the went-home button steps aside while a details sheet is open and is back when it closes", async ({
    context,
    page,
  }) => {
    // Given one live employee and one departure today
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const sessions = client.db(E2E_DB).collection("sessions");
    await sessions.deleteMany({});
    await sessions.insertMany([
      {
        machineName: "Studio Mac",
        machineId: "m1",
        sessionId: "live",
        deskName: "Paint the fence",
        cwd: "/Users/q/projects/live",
        state: "idle",
        startedAt: new Date("2026-11-07T01:00:00.000Z"),
        changedAt: new Date("2026-11-08T02:00:00.000Z"),
      },
      {
        machineName: "Studio Mac",
        machineId: "m1",
        sessionId: "today",
        cwd: "/Users/q/projects/today",
        state: "wentHome",
        hadPrompt: true,
        startedAt: new Date("2026-11-07T01:00:00.000Z"),
        endedAt: new Date("2026-11-08T01:05:00.000Z"),
        changedAt: new Date("2026-11-08T01:05:00.000Z"),
      },
    ]);
    await signInAsOwner(context);
    await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

    try {
      await page.goto("/");
      const button = page.getByTestId("went-home-button");
      await expect(button).toBeVisible();

      // When the owner taps the employee's card in the bar
      await page.getByTestId("agent-card").tap();

      // Then the details sheet is open and the button is out of its way
      const panel = page.getByTestId("details-panel");
      await expect(panel).toContainText("Paint the fence");
      await expect(button).toBeHidden();

      // When the sheet closes
      await panel.getByRole("button", { name: /close/i }).tap();

      // Then the button is back
      await expect(panel).toHaveCount(0);
      await expect(button).toBeVisible();
    } finally {
      await sessions.deleteMany({});
      await client.close();
    }
  });
});
