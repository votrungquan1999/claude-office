import { expect, test } from "@playwright/test";
import {
  keepOneCompany,
  type SeedSession,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

keepOneCompany("m1", "/Users/q/personal");

const MIN = 60_000;

/** Seeds the company's sessions, replacing every earlier one. */
async function seed(rows: SeedSession[]) {
  await withE2eDb((db) => seedSessions(db.collection("sessions"), rows));
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.collection("sessions").deleteMany({});
  });
});

test.describe("the list beside the office on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("shows the company's employees in the owner's order, each row with its state word, time, context line and Remote Control link, and a Review row with an Idle button", async ({
    context,
    page,
  }) => {
    // Given one unplaced employee and four placed ones in different states
    const now = Date.now();
    await seed([
      {
        sessionId: "placed-c",
        deskName: "Third placed",
        rank: "c",
        state: "idle",
        stateSince: new Date(now - 90 * MIN),
        recentSteps: [
          {
            id: "r1",
            text: "Update notes.md",
            startedAt: new Date(now - 95 * MIN),
            status: "ok",
          },
        ],
      },
      {
        sessionId: "placed-a",
        deskName: "First placed",
        rank: "a",
        state: "working",
        stateSince: new Date(now - 3 * MIN),
        runningSteps: [
          { text: "Edit b.ts", startedAt: new Date(now - 3 * MIN) },
        ],
        bridgeSessionId: "cse_first",
      },
      {
        sessionId: "placed-d",
        deskName: "Fourth placed",
        rank: "d",
        state: "review",
        stateSince: new Date(now - 18 * MIN),
      },
      {
        sessionId: "placed-b",
        deskName: "Second placed",
        rank: "b",
        state: "needsPermission",
        stateSince: new Date(now - 4 * MIN),
        runningSteps: [
          { text: "Bash uv run pytest", startedAt: new Date(now - 4 * MIN) },
        ],
        bridgeSessionId: "cse_second",
      },
      {
        sessionId: "unplaced",
        deskName: "Brand new",
        state: "waitingForYou",
        stateSince: new Date(now - 30_000),
        startedAt: new Date(now - 30_000),
      },
    ]);
    await signInAsOwner(context);

    // When the owner opens the office on a desktop
    await page.goto("/");
    await waitForEmployees(page, 5);

    // Then the list beside the office counts five employees
    await expect(page.getByTestId("list-title")).toHaveText(
      "personal · 5 employees",
    );

    // And the unplaced one is on top, then the placed ones in their order
    const rows = page.getByTestId("list-row");
    await expect(rows.getByTestId("list-row-name")).toHaveText([
      "Brand new",
      "First placed",
      "Second placed",
      "Third placed",
      "Fourth placed",
    ]);

    // And each row says its state word, time in state and what it is doing
    const status = (name: string) =>
      rows.filter({ hasText: name }).getByTestId("list-row-status");
    await expect(status("Brand new")).toHaveText(
      /^Waiting for you · \d+s · waiting for your reply$/,
    );
    await expect(status("First placed")).toHaveText(
      /^Working · 3m \d\ds · Edit b\.ts$/,
    );
    await expect(status("Second placed")).toHaveText(
      /^Needs permission · 4m \d\ds · wants to run: Bash uv run pytest$/,
    );
    await expect(status("Third placed")).toHaveText(
      /^Idle · 1h \d\dm · last: Update notes\.md$/,
    );
    await expect(status("Fourth placed")).toHaveText(/^Review · 18m \d\ds$/);

    // And a row with Remote Control links to it, one without has no link
    await expect(
      rows
        .filter({ hasText: "First placed" })
        .getByRole("link", { name: /Remote Control/ }),
    ).toHaveAttribute("href", "https://claude.ai/code/cse_first");
    await expect(
      rows
        .filter({ hasText: "Third placed" })
        .getByRole("link", { name: /Remote Control/ }),
    ).toHaveCount(0);

    // And only the Review row has an Idle button
    await expect(
      page.getByRole("button", { name: "Move to Idle" }),
    ).toHaveCount(1);
    await expect(
      rows
        .filter({ hasText: "Fourth placed" })
        .getByRole("button", { name: "Move to Idle" }),
    ).toBeVisible();
  });

  test("a desk that is not running, waiting at the Mac or starting never reads Idle, and has no Remote Control link", async ({
    context,
    page,
  }) => {
    // Given three kept desks stored as idle, each with a Remote Control id
    const bridgeSessionId = "cse_old";
    await seed([
      {
        sessionId: "closed",
        deskName: "Closed window",
        kept: "hired",
        notRunning: true,
        bridgeSessionId,
      },
      {
        sessionId: "trust",
        deskName: "Trust question",
        kept: "hired",
        waitingAtMac: true,
        bridgeSessionId,
      },
      {
        sessionId: "opening",
        deskName: "Opening window",
        kept: "hired",
        starting: true,
        bridgeSessionId,
      },
    ]);
    await signInAsOwner(context);

    // When the owner opens the office
    await page.goto("/");
    await waitForEmployees(page, 3);

    // Then each row says what the desk is, not Idle, and offers no link
    const status = (name: string) =>
      page
        .getByTestId("list-row")
        .filter({ hasText: name })
        .getByTestId("list-row-status");
    await expect(status("Closed window")).toHaveText(/^Not running/);
    await expect(status("Trust question")).toHaveText(/^Waiting at the Mac/);
    await expect(status("Opening window")).toHaveText(/^Starting/);
    await expect(page.getByTestId("list-everyone")).not.toContainText("Idle");
    await expect(
      page.getByRole("link", { name: /Remote Control/ }),
    ).toHaveCount(0);
  });

  test("on a Mac that stopped sending heartbeats the rows say Mac offline with no time, and are greyed", async ({
    context,
    page,
  }) => {
    // Given the Mac last seen ten minutes ago, with a working employee
    const now = Date.now();
    await withE2eDb(async (db) => {
      await db
        .collection("machines")
        .updateOne(
          { machineId: "m1" },
          { $set: { lastSeenAt: new Date(now - 10 * MIN) } },
        );
    });
    await seed([
      {
        sessionId: "away",
        deskName: "Away worker",
        state: "working",
        stateSince: new Date(now - 3 * MIN),
        runningSteps: [
          { text: "Edit b.ts", startedAt: new Date(now - 3 * MIN) },
        ],
      },
    ]);
    await signInAsOwner(context);

    // When the owner opens the office
    await page.goto("/");
    await waitForEmployees(page, 1);

    // Then the row reads Mac offline, with no time and no step, and is dimmed
    const row = page.getByTestId("list-row");
    await expect(row.getByTestId("list-row-status")).toHaveText("Mac offline");
    await expect(row).toHaveCSS("opacity", "0.6");
  });

  test("the Idle button moves a Review row to Idle, and the pencil renames the employee from the row", async ({
    context,
    page,
  }) => {
    // Given a Review employee
    await seed([
      {
        sessionId: "r",
        deskName: "Audit emails",
        state: "review",
        stateSince: new Date(Date.now() - 5 * MIN),
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 1);
    const row = page.getByTestId("list-row");

    // When the owner presses Idle on the row
    await row.getByRole("button", { name: "Move to Idle" }).click();

    // Then the row reads Idle and the button is gone
    await expect(row.getByTestId("list-row-status")).toHaveText(/^Idle/);
    await expect(row.getByRole("button", { name: "Move to Idle" })).toHaveCount(
      0,
    );

    // When the owner renames it from the pencil
    await row.getByRole("button", { name: "Rename Audit emails" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename employee" });
    await dialog.getByLabel("Name").fill("Email auditor");
    await dialog.getByRole("button", { name: "Save" }).click();

    // Then the row shows the new name
    await expect(row.getByTestId("list-row-name")).toHaveText("Email auditor");
  });

  test("a repo tag picked in the office narrows the list too, rows show their first tag and +N, and the count follows", async ({
    context,
    page,
  }) => {
    // Given three employees, two of them with the api tag
    const api = { name: "api", key: "aaaaaaaaaaaa" };
    const web = { name: "web", key: "bbbbbbbbbbbb" };
    await seed([
      { sessionId: "a", deskName: "Both tags", tags: [api, web] },
      { sessionId: "b", deskName: "Api only", tags: [api] },
      { sessionId: "c", deskName: "No tag" },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 3);
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: name });

    // Then a row shows its first tag and how many more it has
    await expect(row("Both tags").getByTestId("list-row-tag")).toHaveText(
      "#api",
    );
    await expect(row("Both tags")).toContainText("+1");

    // When the owner picks the web tag
    await page
      .getByTestId("tag-filter")
      .locator("button[aria-expanded]")
      .click();
    await page
      .getByRole("dialog", { name: "Filter by repo" })
      .getByRole("button", { name: "web 1" })
      .click();

    // Then the list holds only the web employee and counts one
    await expect(page.getByTestId("list-row-name")).toHaveText(["Both tags"]);
    await expect(page.getByTestId("list-title")).toHaveText(
      "personal · 1 employee",
    );
  });
});

test.describe("the list beside the office on an iPad", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("is the same panel next to the pixel office, and the strip of employee cards is gone", async ({
    context,
    page,
  }) => {
    // Given two employees
    await seed([
      {
        sessionId: "a",
        deskName: "First one",
        startedAt: new Date(Date.now() - 10 * MIN),
      },
      { sessionId: "b", deskName: "Second one", startedAt: new Date() },
    ]);
    await signInAsOwner(context);

    // When the owner opens the office on an iPad
    await page.goto("/");
    await waitForEmployees(page, 2);

    // Then the list sits beside the office with both employees
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Second one",
      "First one",
    ]);
    const panel = (await page.getByTestId("list-panel").boundingBox()) ?? {
      x: 0,
      width: 0,
    };
    const canvas = (await page.getByTestId("office-canvas").boundingBox()) ?? {
      x: 0,
      width: 0,
    };
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x + 1);

    // And the strip of employee cards is not there
    await expect(page.getByTestId("agent-card-bar")).toHaveCount(0);
  });
});

test.describe("Went home today in the list", () => {
  // Local midnight is 17:00Z the day before in this zone, so "today" is fixed whatever the host's zone is.
  test.use({
    viewport: { width: 1600, height: 1200 },
    hasTouch: false,
    timezoneId: "Asia/Ho_Chi_Minh",
  });

  test("is a folded section at the bottom with today's prompted departures only, replaces the floating button, and a row opens its card without selecting anyone in the office", async ({
    context,
    page,
  }) => {
    // Given a live employee and three that ended: today, yesterday, and today without ever getting a prompt
    const started = new Date("2026-11-07T01:00:00.000Z");
    const ended = (sessionId: string, endedAt: string, hadPrompt: boolean) => ({
      sessionId,
      cwd: `/Users/q/personal/${sessionId}`,
      state: "wentHome",
      hadPrompt,
      startedAt: started,
      endedAt: new Date(endedAt),
    });
    await seed([
      {
        sessionId: "live",
        deskName: "Paint the fence",
        startedAt: started,
      },
      {
        ...ended("today", "2026-11-08T01:05:00.000Z", true),
        deskName: "Light the lantern",
      },
      ended("yesterday", "2026-11-07T16:00:00.000Z", true),
      ended("quiet", "2026-11-08T01:30:00.000Z", false),
    ]);
    await signInAsOwner(context);
    // It is 10:00 on Nov 8 in the browser's zone.
    await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });

    // When the owner opens the office
    await page.goto("/");
    await waitForEmployees(page, 1);

    // Then the section sits folded under the employees, counts today's departure, and no floating button is left
    const toggle = page.getByRole("button", { name: /^Went home today/ });
    await expect(toggle).toHaveText(/Went home today\s*1$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("went-home-list")).toHaveCount(0);
    await expect(page.getByTestId("went-home-button")).toHaveCount(0);
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Paint the fence",
    ]);

    // When the owner unfolds it
    await toggle.click();

    // Then it lists the departure with where it ran and when it left
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByTestId("went-home-list").getByRole("listitem"),
    ).toHaveText(["Light the lanternStudio Mac / personal/todayleft 08:05"]);

    // When the owner clicks the row
    await page
      .getByTestId("went-home-list")
      .getByRole("listitem")
      .first()
      .click();

    // Then its card shows, as Went home, and no one is selected in the office
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText("Light the lantern");
    await expect(panel.getByTestId("state-pill")).toHaveText("Went home");
    expect(
      await page.evaluate(() => window.__officeTestHooks?.getSelectedAgentId()),
    ).toBeNull();
  });
});
