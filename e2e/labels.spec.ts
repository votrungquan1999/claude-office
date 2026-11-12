import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  employeeLabelled,
  hoverEmployee,
  keepOneCompany,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// The canvas and its labels are not drawn on a phone, which shows stacked rooms.
test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

const base = {
  machineId: "m1",
  machineName: "Studio Mac",
  startedAt: new Date(),
  changedAt: new Date(),
};

/** One session per state, so every label rule has a subject. */
async function seed(sessions: Collection) {
  await sessions.deleteMany({});
  await sessions.insertMany([
    {
      ...base,
      sessionId: "w",
      cwd: "/Users/q/work",
      state: "working",
      runningSteps: [{ text: "Editing foo.ts", startedAt: new Date() }],
    },
    { ...base, sessionId: "t", cwd: "/Users/q/think", state: "thinking" },
    { ...base, sessionId: "p", cwd: "/Users/q/perm", state: "needsPermission" },
    { ...base, sessionId: "q", cwd: "/Users/q/wait", state: "idle" },
  ]);
}

test.describe("employee labels", () => {
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

  test("no label panel is drawn until an employee is hovered or selected, while the permission bubble stays", async ({
    page,
  }) => {
    // Given the office with four employees
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(4);

    // Then no label panel is in the page, but the permission bubble is shown
    await expect(page.getByTestId("agent-overlay")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__officeTestHooks
              ?.getCharacters()
              .filter((c) => c.bubbleType === "permission").length,
        ),
      )
      .toBe(1);

    // When one employee is selected
    const id = await page.evaluate(
      () => window.__officeTestHooks?.getCharacters()[0].id ?? -1,
    );
    await page.evaluate((i) => window.__officeTestHooks?.selectAgent(i), id);

    // Then only that employee's label is drawn
    await expect(page.getByTestId("agent-overlay")).toHaveCount(1);
    await expect(page.getByTestId("agent-overlay")).toHaveAttribute(
      "data-agent-id",
      String(id),
    );

    // When the selection is cleared and another employee is hovered
    await page.evaluate(() => window.__officeTestHooks?.selectAgent(-1));
    const other = await page.evaluate(
      () => window.__officeTestHooks?.getCharacters()[1].id ?? -1,
    );
    await hoverEmployee(page, other);

    // Then that employee's label is drawn
    await expect(page.getByTestId("agent-overlay")).toHaveAttribute(
      "data-agent-id",
      String(other),
    );
  });

  test("the status line follows the session's state, never the renderer's Idle", async ({
    page,
  }) => {
    // Given the office with one employee per state
    await page.goto("/");
    await waitForEmployees(page, 4);

    // When each is selected, then its status line names its state
    const expected: Array<[string, string]> = [
      ["Studio Mac / work", "Working: Editing foo.ts"],
      ["Studio Mac / think", "Thinking"],
      ["Studio Mac / perm", "Needs permission"],
      ["Studio Mac / wait", "Idle"],
    ];
    for (const [label, status] of expected) {
      const id = await employeeLabelled(page, label);
      await page.evaluate((i) => window.__officeTestHooks?.selectAgent(i), id);
      await expect(page.getByTestId("agent-status")).toHaveText(status);
    }
  });
  test("a label names the project below the company folder, or the company when the session started at it", async ({
    page,
  }) => {
    // Given the company folder /Users/q with one session started below it and one at it
    await sessions.deleteMany({});
    await sessions.insertMany([
      {
        ...base,
        sessionId: "below",
        cwd: "/Users/q/elsewhere",
        startCwd: "/Users/q/claude-office",
        state: "idle",
      },
      {
        ...base,
        sessionId: "at",
        cwd: "/Users/q/elsewhere",
        startCwd: "/Users/q",
        state: "idle",
      },
    ]);

    // When the office loads
    await page.goto("/");
    await waitForEmployees(page, 2);

    // Then one label shows the project and the other the company name
    await employeeLabelled(page, "Studio Mac / claude-office");
    await employeeLabelled(page, "Studio Mac / q");
  });
});
