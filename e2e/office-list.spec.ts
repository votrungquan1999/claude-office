import { expect, type Locator, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./constants";
import {
  clickEmployee,
  employeeLabelled,
  keepOneCompany,
  type SeedSession,
  seedFolders,
  seedOnlineMachine,
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

    // And a Needs permission row's link reads "Approve ↗" where the others show only the arrow
    await expect(
      rows
        .filter({ hasText: "Second placed" })
        .getByRole("link", { name: "Approve in Remote Control" }),
    ).toHaveText("Approve ↗");
    await expect(
      rows
        .filter({ hasText: "First placed" })
        .getByRole("link", { name: /Remote Control/ }),
    ).toHaveText("↗");

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
      page
        .getByTestId("list-everyone")
        .getByRole("button", { name: "Move to Idle" }),
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

test.describe("new conversations in the list", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("a conversation that arrives after the list showed joins the top with a new dot until it is opened, and the dot stays gone after a reload", async ({
    context,
    page,
  }) => {
    // Given one conversation and the office already open
    await seed([
      {
        sessionId: "old",
        deskName: "Old task",
        startedAt: new Date(Date.now() - 60 * MIN),
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 1);
    const dots = page.getByTestId("list-row-new");
    await expect(dots).toHaveCount(0);

    // When a new conversation starts
    await withE2eDb((db) =>
      db.collection("sessions").insertOne({
        machineId: "m1",
        machineName: "Studio Mac",
        sessionId: "fresh",
        deskName: "Fresh task",
        cwd: "/Users/q/personal",
        state: "idle",
        startedAt: new Date(),
        changedAt: new Date(),
      }),
    );

    // Then it joins the top of the list with the only new dot
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveText(["Fresh task", "Old task"], {
      timeout: 20_000,
    });
    await expect(dots).toHaveCount(1);
    await expect(
      page
        .getByTestId("list-row")
        .filter({ hasText: "Fresh task" })
        .getByTestId("list-row-new"),
    ).toBeVisible();

    // When the owner opens it
    await names.first().click();

    // Then the dot is gone, and still gone after a reload
    await expect(dots).toHaveCount(0);
    await page.reload();
    await waitForEmployees(page, 2);
    await expect(names).toHaveText(["Fresh task", "Old task"]);
    await expect(dots).toHaveCount(0);
  });
});

test.describe("a conversation that went home", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("keeps its place in the list and is back there when it is woken", async ({
    context,
    page,
  }) => {
    // Given three placed conversations, the middle one gone home
    const ended = new Date(Date.now() - MIN);
    await seed([
      { sessionId: "p", deskName: "First task", rank: "a" },
      {
        sessionId: "r",
        deskName: "Middle task",
        rank: "b",
        state: "wentHome",
        hadPrompt: true,
        endedAt: ended,
      },
      { sessionId: "q", deskName: "Last task", rank: "c" },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 2);
    const names = page.getByTestId("list-row-name");
    await expect(names).toHaveText(["First task", "Last task"]);

    // When the same conversation is resumed
    await withE2eDb((db) =>
      db.collection("sessions").updateOne(
        { sessionId: "r" },
        {
          $set: { state: "idle", changedAt: new Date() },
          $unset: { endedAt: "" },
        },
      ),
    );

    // Then it is back between the other two, with no new dot
    await expect(names).toHaveText(["First task", "Middle task", "Last task"], {
      timeout: 20_000,
    });
    await expect(page.getByTestId("list-row-new")).toHaveCount(0);
  });
});

/** Drags a row with the mouse to the top edge of another row, in small steps like a hand; `release: false` keeps the button down. */
async function dragRow(
  page: Page,
  from: Locator,
  to: Locator,
  { release = true } = {},
) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("dragRow: a row is not rendered");
  await page.mouse.move(start.x + 100, start.y + start.height / 2);
  await page.mouse.down();
  const targetY = end.y + 4;
  const fromY = start.y + start.height / 2;
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(
      start.x + 100,
      fromY + ((targetY - fromY) * step) / 12,
    );
  }
  if (release) await page.mouse.up();
}

test.describe("dragging a row", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  /** Four placed conversations, A first. */
  const placed = () =>
    seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
  const names = (page: Page) => page.getByTestId("list-row-name");
  const row = (page: Page, name: string) =>
    page.getByTestId("list-row").filter({ hasText: `Task ${name}` });

  test("dropping a row moves it with one request, it holds after a reload and on a second device, and the row's employee is not selected", async ({
    browser,
    context,
    page,
  }) => {
    // Given four placed conversations and a second device that has the office open
    await placed();
    await signInAsOwner(context);
    const requests: string[] = [];
    let answered = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/rank"))
        requests.push(request.postData() ?? "");
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/office/sessions/rank")) answered++;
    });
    const second = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    });
    await signInAsOwner(second);
    const otherPage = await second.newPage();
    try {
      await otherPage.goto("/");
      await expect(names(otherPage)).toHaveText([
        "Task A",
        "Task B",
        "Task C",
        "Task D",
      ]);
      await page.goto("/");
      await waitForEmployees(page, 4);

      // When the owner drags the last row to the top
      await dragRow(page, row(page, "D"), row(page, "A"));

      // Then it is first at once, with exactly one request
      await expect(names(page)).toHaveText([
        "Task D",
        "Task A",
        "Task B",
        "Task C",
      ]);
      await expect.poll(() => answered).toBe(1);
      expect(requests).toHaveLength(1);
      await expect(page.getByTestId("details-panel")).toHaveCount(0);

      // And it is still first after a reload
      await page.reload();
      await waitForEmployees(page, 4);
      await expect(names(page)).toHaveText([
        "Task D",
        "Task A",
        "Task B",
        "Task C",
      ]);

      // And the second device shows the same order after its next poll
      await expect(names(otherPage)).toHaveText(
        ["Task D", "Task A", "Task B", "Task C"],
        { timeout: 20_000 },
      );
      expect(requests).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});

test.describe("the employee of a dragged row", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("lights up in the office while its row is dragged, and not after it is dropped or cancelled", async ({
    context,
    page,
  }) => {
    // Given four placed conversations
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 4);
    const dee = await employeeLabelled(page, "Task D");
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: `Task ${name}` });
    const hovered = () =>
      page.evaluate(() => window.__officeTestHooks?.getHoveredAgentId());
    await page.mouse.move(5, 5);
    expect(await hovered()).toBeNull();

    // When the owner drags D's row and holds it over A
    await dragRow(page, row("D"), row("A"), { release: false });

    // Then D's employee is lit up
    await expect.poll(hovered).toBe(dee);

    // When the owner presses Esc
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Then it is not lit up any more
    await expect.poll(hovered).toBeNull();
    // The cancelled row glides back; wait until it stops moving before grabbing it again
    let lastTop = Number.NaN;
    await expect
      .poll(async () => {
        const top = (await row("D").boundingBox())?.y;
        const settled = top === lastTop;
        lastTop = top ?? Number.NaN;
        return settled;
      })
      .toBe(true);

    // When the owner drags D's row again and drops it
    await dragRow(page, row("D"), row("A"), { release: false });
    await expect.poll(hovered).toBe(dee);
    await page.mouse.up();

    // Then it is not lit up after the drop either
    await expect.poll(hovered).toBeNull();
  });
});

test.describe("the look of a dragged row", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("each row has a grip, the dragged row is opaque and above its neighbours, a dashed gap says where it drops, and a screen reader hears its new place", async ({
    context,
    page,
  }) => {
    // Given four placed conversations
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 4);
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: `Task ${name}` });

    // Then every row shows a grip labelled "Drag to reorder"
    await expect(page.getByLabel("Drag to reorder")).toHaveCount(4);

    // When the owner holds D over B
    await dragRow(page, row("D"), row("B"), { release: false });

    // Then the dragged row has a solid background and sits above the rows it passes over
    const look = (name: string) =>
      row(name).evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, z: style.zIndex };
      });
    const dragged = await look("D");
    expect(dragged.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(Number(dragged.z)).toBeGreaterThan(Number((await look("B")).z) || 0);
    // And a gap reads "Drops here"
    await expect(page.getByText("Drops here")).toBeVisible();
    // And a visible status chip names the employee and its place
    const chip = page.getByTestId("drag-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("Moving Task D to position 2 of 4");
    await expect(chip).toHaveAttribute("role", "status");
    // And a screen reader hears the same
    await expect(page.locator("[id^=DndLiveRegion]")).toContainText(
      "Moving Task D to position 2 of 4",
    );

    // When the owner presses Esc
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Then the gap and the chip are gone
    await expect(page.getByText("Drops here")).toHaveCount(0);
    await expect(chip).toHaveCount(0);
  });
});

test.describe("a row dropped while another conversation arrives", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("lands on the place of the row it was dropped on, counted in the order the owner sees after the arrival", async ({
    context,
    page,
  }) => {
    // Given four placed conversations
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 4);
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: `Task ${name}` });

    // When the owner holds D over A and a new conversation arrives before the drop
    await dragRow(page, row("D"), row("A"), { release: false });
    await withE2eDb((db) =>
      db.collection("sessions").insertOne({
        machineId: "m1",
        machineName: "Studio Mac",
        sessionId: "arrival",
        deskName: "Task E",
        cwd: "/Users/q/personal",
        state: "idle",
        startedAt: new Date(),
        changedAt: new Date(),
      }),
    );
    await waitForEmployees(page, 5);
    await page.mouse.up();

    // Then D sits where A was, so below the arrival
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Task E",
      "Task D",
      "Task A",
      "Task B",
      "Task C",
    ]);
  });
});

test.describe("a row that is not dropped somewhere new", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("sends nothing for a click without movement, a drag cancelled with Esc, or a drop on its own place", async ({
    context,
    page,
  }) => {
    // Given four placed conversations
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/rank"))
        requests.push(request.url());
    });
    await page.goto("/");
    await waitForEmployees(page, 4);
    const names = page.getByTestId("list-row-name");
    const original = ["Task A", "Task B", "Task C", "Task D"];
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: `Task ${name}` });

    // When the owner clicks a row without moving the mouse
    await row("C").getByTestId("list-row-name").click();

    // Then it is selected, with its card
    await expect(page.getByTestId("details-panel")).toContainText("Task C");

    // When the owner starts dragging D to the top and presses Esc before letting go
    await dragRow(page, row("D"), row("A"), { release: false });
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Then the order is as before
    await expect(names).toHaveText(original);

    // When the owner drags B a little way and lets go over its own place
    const box = await row("B").boundingBox();
    if (!box) throw new Error("row B is not rendered");
    const x = box.x + 100;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 6, { steps: 3 });
    await page.mouse.move(x, y + 12, { steps: 3 });
    await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.up();

    // Then the order is as before, and no request was ever sent
    await expect(names).toHaveText(original);
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });
});

test.describe("the rename dialog opened from a row", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("dragging inside its name field moves no row and sends no request", async ({
    context,
    page,
  }) => {
    // Given four placed conversations and D's rename dialog open
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/rank"))
        requests.push(request.url());
    });
    await page.goto("/");
    await waitForEmployees(page, 4);
    await page.getByRole("button", { name: "Rename Task D" }).click();
    const field = page.getByRole("dialog").getByRole("textbox");
    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    if (!box) throw new Error("the name field is not rendered");

    // When the owner presses in the name field and drags well past the rows above
    const x = box.x + 40;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++)
      await page.mouse.move(x, y - (step * 300) / 12);
    await page.mouse.up();

    // Then no row moved and no request was sent
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
    ]);
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });
});

test.describe("a refused move", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("puts the row back and says so under the list's header", async ({
    context,
    page,
  }) => {
    // Given four placed conversations and a server that refuses the save
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
      })),
    );
    await signInAsOwner(context);
    await page.route("**/api/office/sessions/rank", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto("/");
    await waitForEmployees(page, 4);

    // When the owner drags D to the top
    await dragRow(
      page,
      page.getByTestId("list-row").filter({ hasText: "Task D" }),
      page.getByTestId("list-row").filter({ hasText: "Task A" }),
    );

    // Then the row is back in its old place, and an alert says the move failed
    await expect(page.getByTestId("list-move-error")).toHaveText(
      "Could not move. Try again.",
    );
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
    ]);
  });
});

test.describe("selecting from the list and from the office", () => {
  test.use({
    viewport: { width: 1600, height: 1200 },
    hasTouch: false,
    timezoneId: "Asia/Ho_Chi_Minh",
  });

  test("a row click selects its employee in the office and opens its card, an office click highlights the row, closing the card clears both, and a went-home row opens its card with no one selected", async ({
    context,
    page,
  }) => {
    // Given two live employees and one departure today
    const started = new Date("2026-11-07T01:00:00.000Z");
    await seed([
      { sessionId: "a", deskName: "Alpha task", startedAt: started },
      {
        sessionId: "b",
        deskName: "Bravo task",
        startedAt: new Date("2026-11-07T02:00:00.000Z"),
      },
      {
        sessionId: "gone",
        deskName: "Gone task",
        cwd: "/Users/q/personal/gone",
        state: "wentHome",
        hadPrompt: true,
        startedAt: started,
        endedAt: new Date("2026-11-08T01:05:00.000Z"),
      },
    ]);
    await signInAsOwner(context);
    await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });
    await page.goto("/");
    await waitForEmployees(page, 2);
    const alpha = await employeeLabelled(page, "Alpha task");
    const bravo = await employeeLabelled(page, "Bravo task");
    const row = (name: string) =>
      page.getByTestId("list-row").filter({ hasText: name });
    const panel = page.getByTestId("details-panel");
    const selected = () =>
      page.evaluate(() => window.__officeTestHooks?.getSelectedAgentId());

    // When the owner clicks Bravo's row, twice
    await row("Bravo task").getByTestId("list-row-name").click();
    await row("Bravo task").getByTestId("list-row-name").click();

    // Then Bravo is selected in the office, its card shows, and its row is highlighted
    await expect.poll(selected).toBe(bravo);
    await expect(panel).toContainText("Bravo task");
    await expect(row("Bravo task")).toHaveAttribute("aria-current", "true");
    await expect(row("Alpha task")).not.toHaveAttribute("aria-current");
    // And the selected row looks different from the other one
    const background = (name: string) =>
      row(name).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await background("Bravo task")).not.toBe(
      await background("Alpha task"),
    );

    // When the owner clicks Alpha in the office
    await clickEmployee(page, alpha);

    // Then Alpha's row is highlighted instead
    await expect(row("Alpha task")).toHaveAttribute("aria-current", "true");
    await expect(row("Bravo task")).not.toHaveAttribute("aria-current");
    await expect(panel).toContainText("Alpha task");

    // When the owner closes the card
    await panel.getByRole("button", { name: "Close" }).click();

    // Then no one is selected and no row is highlighted
    await expect(panel).toHaveCount(0);
    expect(await selected()).toBeNull();
    await expect(
      page.locator('[data-testid="list-row"][aria-current]'),
    ).toHaveCount(0);

    // When the owner selects Alpha's row and then opens the departure from Went home today
    await row("Alpha task").getByTestId("list-row-name").click();
    await expect.poll(selected).toBe(alpha);
    await page
      .getByTestId("list-panel")
      .getByRole("button", { name: /^Went home today/ })
      .click();
    await page.getByTestId("went-home-list").getByRole("listitem").click();

    // Then the departure's card shows and nobody is selected in the office or highlighted in the list
    await expect(panel).toContainText("Gone task");
    expect(await selected()).toBeNull();
    await expect(
      page.locator('[data-testid="list-row"][aria-current]'),
    ).toHaveCount(0);
  });

  test("an employee picked in the office scrolls its row into view in a long list", async ({
    context,
    page,
  }) => {
    // Given thirty employees, the last one far below the top of the list and working at a desk the canvas shows
    const base = Date.now();
    await seed(
      Array.from({ length: 30 }, (_, i) => ({
        sessionId: `t${String(i).padStart(2, "0")}`,
        deskName: `Task ${String(i).padStart(2, "0")}`,
        startedAt: new Date(base - i * MIN),
        ...(i === 29
  test("clicking an employee in the office while Everyone is folded opens its card and leaves Everyone folded", async ({
    context,
    page,
  }) => {
    // Given two employees and Everyone folded
    await seed([
      { sessionId: "a", deskName: "Alpha task" },
      { sessionId: "b", deskName: "Bravo task" },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 2);
    const alpha = await employeeLabelled(page, "Alpha task");
    const everyone = page.getByRole("button", { name: /Everyone/ });
    await everyone.click();
    await expect(everyone).toHaveAttribute("aria-expanded", "false");

    // When the owner clicks an employee in the office
    await clickEmployee(page, alpha);

    // Then its card shows and Everyone is still folded
    await expect(page.getByTestId("details-panel")).toContainText("Alpha task");
    await expect(everyone).toHaveAttribute("aria-expanded", "false");
  });

          ? {
              state: "working",
              runningSteps: [{ text: "Edit a.ts", startedAt: new Date() }],
            }
          : {}),
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 30);
    const last = page.getByTestId("list-row").filter({ hasText: "Task 29" });
    const inView = async () => {
      const box = await last.boundingBox();
      const list = await page.getByTestId("list-everyone").boundingBox();
      if (!box || !list) return false;
      return box.y >= list.y && box.y + box.height <= list.y + list.height;
    };
    expect(await inView()).toBe(false);

    // When the owner clicks that employee in the office
    await clickEmployee(page, await employeeLabelled(page, "Task 29"));

    // Then its row is highlighted and scrolled into view
    await expect(last).toHaveAttribute("aria-current", "true");
    await expect.poll(inView).toBe(true);
  });
});

test.describe("Move to top and Move to bottom on the card", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  const names = (page: Page) => page.getByTestId("list-row-name");

  test("the card shows the row's place, and Move to top sends one request and the place follows", async ({
    context,
    page,
  }) => {
    // Given four placed conversations and the card of the third open
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
        state: "idle",
      })),
    );
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/rank"))
        requests.push(request.postData() ?? "");
    });
    await page.goto("/");
    await waitForEmployees(page, 4);
    await page.getByTestId("list-row").filter({ hasText: "Task C" }).click();
    const place = page.getByTestId("list-place");
    await expect(place).toContainText("now 3rd of 4");

    // When the owner presses Move to top
    await place.getByRole("button", { name: "Move to top" }).click();

    // Then the row is first, the card says 1st of 4 and one request was sent
    await expect(names(page)).toHaveText([
      "Task C",
      "Task A",
      "Task B",
      "Task D",
    ]);
    await expect(place).toContainText("now 1st of 4");
    await expect(
      place.getByRole("button", { name: "Move to top" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(requests).toHaveLength(1);
  });

  test("Move to bottom puts the row last with one request", async ({
    context,
    page,
  }) => {
    // Given four placed conversations and the card of the second open
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
        state: "idle",
      })),
    );
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/rank"))
        requests.push(request.postData() ?? "");
    });
    await page.goto("/");
    await waitForEmployees(page, 4);
    await page.getByTestId("list-row").filter({ hasText: "Task B" }).click();
    const place = page.getByTestId("list-place");
    await expect(place).toContainText("now 2nd of 4");

    // When the owner presses Move to bottom
    await place.getByRole("button", { name: "Move to bottom" }).click();

    // Then the row is last, the card says 4th of 4 and one request was sent
    await expect(names(page)).toHaveText([
      "Task A",
      "Task C",
      "Task D",
      "Task B",
    ]);
    await expect(place).toContainText("now 4th of 4");
    expect(requests).toHaveLength(1);
  });

  test("the place counts the whole company while a repo filter hides rows", async ({
    context,
    page,
  }) => {
    // Given four placed conversations, only the first and the third tagged web
    const web = { name: "web", key: "bbbbbbbbbbbb" };
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
        state: "idle",
        tags: i % 2 === 0 ? [web] : undefined,
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 4);
    await page.getByTestId("list-row").filter({ hasText: "Task C" }).click();
    await expect(page.getByTestId("list-place")).toContainText("now 3rd of 4");

    // When the owner filters to the web repo
    await page
      .getByTestId("tag-filter")
      .locator("button[aria-expanded]")
      .click();
    await page
      .getByRole("dialog", { name: "Filter by repo" })
      .getByRole("button", { name: "web 2" })
      .click();
    await expect(names(page)).toHaveText(["Task A", "Task C"]);

    // Then the card still says 3rd of 4
    await expect(page.getByTestId("list-place")).toContainText("now 3rd of 4");
  });

  test("a refused move puts the place back and shows its alert on the card", async ({
    context,
    page,
  }) => {
    // Given four placed conversations, the card of the third open and a server that refuses the save
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
        state: "idle",
      })),
    );
    await signInAsOwner(context);
    await page.route("**/api/office/sessions/rank", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto("/");
    await waitForEmployees(page, 4);
    await page.getByTestId("list-row").filter({ hasText: "Task C" }).click();
    const place = page.getByTestId("list-place");

    // When the owner presses Move to top
    await place.getByRole("button", { name: "Move to top" }).click();

    // Then the card says so and the place is back
    await expect(place.getByRole("alert")).toHaveText(
      "Could not move. Try again.",
    );
    await expect(place).toContainText("now 3rd of 4");
    await expect(names(page)).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
    ]);
  });

  test("a card of an employee that went home has no place", async ({
    context,
    page,
  }) => {
    // Given one live and one gone-home conversation
    await seed([
      { sessionId: "a", deskName: "Live task", rank: "a", state: "idle" },
      {
        sessionId: "b",
        deskName: "Gone task",
        rank: "b",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(Date.now() - MIN),
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 1);

    // When the owner opens the gone one's card from Went home today
    await page.getByRole("button", { name: /^Went home today/ }).click();
    await page
      .getByTestId("went-home-list")
      .getByRole("listitem")
      .first()
      .click();

    // Then its card shows as Went home with no place block
    const panel = page.getByTestId("details-panel");
    await expect(panel.getByTestId("state-pill")).toHaveText("Went home");
    await expect(page.getByTestId("list-place")).toHaveCount(0);
  });
});

test.describe("the place on a phone's card", () => {
  test("shows the place below Open Remote Control with both buttons inside the screen", async ({
    context,
    page,
  }) => {
    // Given four placed conversations seen on a phone
    await seedOnlineMachine("m1", "Quan's MacBook Pro");
    await seed(
      ["A", "B", "C", "D"].map((name, i) => ({
        sessionId: name.toLowerCase(),
        deskName: `Task ${name}`,
        rank: "bdfh"[i],
        state: "working",
        bridgeSessionId: `bridge-${name}`,
        runningSteps: [{ text: "Edit b.ts", startedAt: new Date() }],
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 4);

    // When the owner taps Task C's row in the phone's list
    await page
      .getByTestId("list-row")
      .getByRole("button", { name: /Task C/ })
      .click();

    // Then the card reads "now 3rd of 4", sits below Open Remote Control, and both buttons are inside the screen
    const place = page.getByTestId("list-place");
    await expect(place).toContainText("now 3rd of 4");
    const link = await page.getByTestId("remote-control-link").boundingBox();
    const block = await place.boundingBox();
    expect(link).not.toBeNull();
    expect(block?.y ?? 0).toBeGreaterThan(
      (link?.y ?? 0) + (link?.height ?? 0) - 1,
    );
    const viewport = page.viewportSize();
    for (const name of ["Move to top", "Move to bottom"]) {
      const box = await place.getByRole("button", { name }).boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        viewport?.height ?? 0,
      );
    }
  });
});

/** Two more Macs beside the spec's own: one online with its own company, one offline. */
async function seedOtherCompanies() {
  await seedOnlineMachine("m2", "Zed Mac");
  await withE2eDb(async (db) => {
    await db.collection("machines").updateOne(
      { machineId: "m3" },
      {
        $set: {
          machineName: "Old Mac",
          lastSeenAt: new Date(Date.now() - 600_000),
        },
      },
      { upsert: true },
    );
    await seedFolders(db.collection("folders"), [
      { machineId: "m1", path: "/Users/q/personal" },
      { machineId: "m2", path: "/Users/q/lab" },
      { machineId: "m3", path: "/Users/q/old" },
    ]);
  });
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db
      .collection("machines")
      .deleteMany({ machineId: { $in: ["m2", "m3"] } });
  });
});

test.describe("the Needs you section", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("copies everyone who needs the owner above Everyone, four per company then 'and N more', other companies under 'In other companies', leaves out an offline Mac, and a click opens the original in its company", async ({
    context,
    page,
  }) => {
    // Given six needing employees here, one in another company, one on an offline Mac, and one idle
    await seedOtherCompanies();
    const own = ["A", "B", "C", "D", "E", "F"].map((name, i) => ({
      sessionId: name.toLowerCase(),
      deskName: `Task ${name}`,
      rank: "bcdefg"[i],
      state: i === 5 ? "review" : "waitingForYou",
      stateSince: new Date(Date.now() - 5 * MIN),
    }));
    await seed([
      ...own,
      { sessionId: "idle", deskName: "Task Idle", rank: "h", state: "idle" },
      {
        sessionId: "lab",
        machineId: "m2",
        machineName: "Zed Mac",
        cwd: "/Users/q/lab/x",
        deskName: "Lab task",
        state: "needsPermission",
        stateSince: new Date(Date.now() - 2 * MIN),
      },
      {
        sessionId: "old",
        machineId: "m3",
        machineName: "Old Mac",
        cwd: "/Users/q/old/x",
        deskName: "Old task",
        state: "waitingForYou",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 7);
    const needs = page.getByTestId("needs-you");

    // Then the section counts seven, shows four own copies, 'and 2 more', and the other company's copy
    await expect(page.getByTestId("needs-count")).toHaveText("7");
    await expect(needs.getByTestId("needs-row-name")).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
      "Lab task",
    ]);
    await expect(needs.getByText("In other companies")).toBeVisible();
    await expect(needs.getByTestId("needs-row-company")).toHaveText("lab");
    await expect(needs.getByText("Old task")).toHaveCount(0);

    // And the originals stay in Everyone
    await expect(page.getByTestId("list-row-name")).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
      "Task E",
      "Task F",
      "Task Idle",
    ]);

    // When the owner expands 'and 2 more'
    await needs.getByRole("button", { name: "and 2 more" }).click();

    // Then the other two copies show in place
    await expect(needs.getByTestId("needs-row-name")).toHaveText([
      "Task A",
      "Task B",
      "Task C",
      "Task D",
      "Task E",
      "Task F",
      "Lab task",
    ]);

    // When a copy of the other company's employee is clicked
    await needs
      .getByTestId("needs-row")
      .filter({ hasText: "Lab task" })
      .getByRole("button")
      .first()
      .click();

    // Then the office shows that company with the employee's card open and its row highlighted
    await expect(page.getByTestId("list-title")).toContainText("lab");
    await expect(page.getByTestId("details-panel")).toContainText("Lab task");
    await expect(
      page.getByTestId("list-row").filter({ hasText: "Lab task" }),
    ).toHaveAttribute("aria-current", "true");
  });
});

test.describe("a Needs you copy hidden by the repo filter", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("still shows, and clicking it clears the filter and opens the original", async ({
    context,
    page,
  }) => {
    // Given one waiting employee with the api tag and one with the web tag
    const api = { name: "api", key: "aaaaaaaaaaaa" };
    const web = { name: "web", key: "bbbbbbbbbbbb" };
    await seed([
      {
        sessionId: "a",
        deskName: "Api task",
        tags: [api],
        state: "waitingForYou",
      },
      {
        sessionId: "b",
        deskName: "Web task",
        tags: [web],
        state: "waitingForYou",
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 2);
    await page
      .getByTestId("tag-filter")
      .locator("button[aria-expanded]")
      .click();
    await page
      .getByRole("dialog", { name: "Filter by repo" })
      .getByRole("button", { name: "web 1" })
      .click();
    await expect(page.getByTestId("list-row-name")).toHaveText(["Web task"]);

    // Then Needs you still lists both
    const needs = page.getByTestId("needs-you");
    await expect(needs.getByTestId("needs-row-name")).toHaveCount(2);

    // When the owner clicks the hidden one's copy
    await needs
      .getByTestId("needs-row")
      .filter({ hasText: "Api task" })
      .getByRole("button")
      .first()
      .click();

    // Then the filter is cleared and its card is open
    await expect(page.getByTestId("list-row-name")).toHaveCount(2);
    await expect(page.getByTestId("details-panel")).toContainText("Api task");
  });
});

test.describe("a Review copy in Needs you", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("has an Idle button that moves the employee to Idle and takes the copy away, with one request", async ({
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
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/review-seen"))
        requests.push(request.postData() ?? "");
    });
    await page.goto("/");
    await waitForEmployees(page, 1);
    const needs = page.getByTestId("needs-you");

    // When the owner presses Idle on the copy
    await needs.getByRole("button", { name: "Move to Idle" }).click();

    // Then the copy and the section are gone, the original reads Idle, and one request was sent
    await expect(page.getByTestId("needs-you")).toHaveCount(0);
    await expect(
      page.getByTestId("list-row").getByTestId("list-row-status"),
    ).toHaveText(/^Idle/);
    expect(requests).toHaveLength(1);
  });
});

test.describe("Move all Review to Idle", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("moves every listed Review employee, also beyond the cap and in another company, with one request, and a second device follows", async ({
    browser,
    context,
    page,
  }) => {
    // Given five Review employees here (one beyond the cap of four), one in another company, and a waiting one
    await seedOtherCompanies();
    const review = (name: string, extra: Record<string, unknown> = {}) => ({
      sessionId: name,
      deskName: `Task ${name}`,
      state: "review",
      stateSince: new Date(Date.now() - 5 * MIN),
      ...extra,
    });
    await seed([
      ...["a", "b", "c", "d", "e"].map((name, i) =>
        review(name, { rank: "bcdef"[i] }),
      ),
      review("lab", {
        machineId: "m2",
        machineName: "Zed Mac",
        cwd: "/Users/q/lab/x",
      }),
      { sessionId: "w", deskName: "Task W", state: "waitingForYou", rank: "g" },
    ]);
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/sessions/review-seen"))
        requests.push(request.postData() ?? "");
    });
    const second = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
    });
    await signInAsOwner(second);
    const otherPage = await second.newPage();
    try {
      await otherPage.goto("/");
      await waitForEmployees(otherPage, 6);
      await page.goto("/");
      await waitForEmployees(page, 6);
      const moveAll = page.getByRole("button", {
        name: "Move all 6 Review to Idle",
      });

      // When the owner presses it once
      await moveAll.click();

      // Then every Review employee reads Idle, the button is gone and one request carried six items
      await expect(
        page.getByTestId("list-everyone").getByTestId("list-row-status"),
      ).toHaveText([/^Idle/, /^Idle/, /^Idle/, /^Idle/, /^Idle/, /^Waiting/]);
      await expect(moveAll).toHaveCount(0);
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]).items).toHaveLength(6);

      // And a second device shows them Idle after its next poll
      await expect(
        otherPage.getByTestId("list-everyone").getByTestId("list-row-status"),
      ).toHaveText([/^Idle/, /^Idle/, /^Idle/, /^Idle/, /^Idle/, /^Waiting/], {
        timeout: 20_000,
      });
    } finally {
      await second.close();
    }
  });
});

test.describe("a refused Move all", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("puts every Review back and says so in the Needs you section", async ({
    context,
    page,
  }) => {
    // Given two Review employees and a server that refuses the move
    await seed(
      ["a", "b"].map((name, i) => ({
        sessionId: name,
        deskName: `Task ${name}`,
        state: "review",
        rank: "bc"[i],
        stateSince: new Date(Date.now() - 5 * MIN),
      })),
    );
    await signInAsOwner(context);
    await page.route("**/api/office/sessions/review-seen", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto("/");
    await waitForEmployees(page, 2);

    // When the owner presses Move all
    await page
      .getByRole("button", { name: "Move all 2 Review to Idle" })
      .click();

    // Then the section says it failed and both stay in Review
    await expect(page.getByTestId("needs-you").getByRole("alert")).toHaveText(
      "Could not move to Idle. Try again.",
    );
    await expect(
      page.getByTestId("list-everyone").getByTestId("list-row-status"),
    ).toHaveText([/^Review/, /^Review/]);
    await expect(
      page.getByRole("button", { name: "Move all 2 Review to Idle" }),
    ).toBeVisible();
  });
});

test.describe("folding the list", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  /** Two waiting employees and one idle. */
  const twoWaiting = () =>
    seed([
      { sessionId: "a", deskName: "Task A", state: "waitingForYou", rank: "b" },
      { sessionId: "b", deskName: "Task B", state: "waitingForYou", rank: "c" },
      { sessionId: "i", deskName: "Task I", state: "idle", rank: "d" },
    ]);
  const waitingArrives = () =>
    withE2eDb(async (db) => {
      await db.collection("sessions").insertOne({
        machineId: "m1",
        machineName: "Studio Mac",
        cwd: "/Users/q/personal",
        sessionId: "new",
        deskName: "Task New",
        state: "waitingForYou",
        stateSince: new Date(),
test.describe("Move all Review to Idle while Needs you is folded", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("the button stays in the folded header and moves the Review employees", async ({
    context,
    page,
  }) => {
    // Given two Review employees and Needs you folded
    await seed(
      ["a", "b"].map((name, i) => ({
        sessionId: name,
        deskName: `Task ${name}`,
        state: "review",
        stateSince: new Date(Date.now() - 5 * MIN),
        rank: "bc"[i],
      })),
    );
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 2);
    await page.getByRole("button", { name: "Needs you", exact: true }).click();
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(0);
    const moveAll = page.getByRole("button", {
      name: "Move all 2 Review to Idle",
    });
    await expect(moveAll).toBeVisible();

    // When the owner presses it
    await moveAll.click();

    // Then both employees read Idle and the button is gone
    await expect(
      page.getByTestId("list-everyone").getByTestId("list-row-status"),
    ).toHaveText([/^Idle/, /^Idle/]);
    await expect(moveAll).toHaveCount(0);
  });
});

        startedAt: new Date(),
        changedAt: new Date(),
      });
    });

  test("each section folds, section folds are remembered after a reload, and the whole list folds to a strip with the count and opens again at every load", async ({
    context,
    page,
  }) => {
    // Given two waiting employees and one idle
    await twoWaiting();
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 3);
    const needsHeader = page.getByRole("button", {
      name: "Needs you",
      exact: true,
    });
    const everyoneHeader = page.getByRole("button", { name: /Everyone/ });
    await expect(
      page.getByTestId("list-row").locator("visible=true"),
    ).toHaveCount(3);

    // When the owner folds Everyone and Needs you
    await everyoneHeader.click();
    await expect(everyoneHeader).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByTestId("list-row").locator("visible=true"),
    ).toHaveCount(0);
    await needsHeader.click();
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(0);

    // Then both stay folded after a reload and the header counts still show
    await page.reload();
    await waitForEmployees(page, 3);
    await expect(
      page.getByTestId("list-row").locator("visible=true"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(0);
    await expect(page.getByTestId("needs-count")).toHaveText("2");

    // When the owner folds the whole list
    await page.getByRole("button", { name: "Fold the list" }).click();

    // Then a strip shows the needs-you count
    const strip = page.getByTestId("list-folded-strip");
    await expect(strip).toHaveAttribute(
      "aria-label",
      "2 need you: open the list",
    );
    await expect(page.getByTestId("list-panel")).toHaveCount(0);

    // And after a reload the whole list is open again with the sections still folded
    await page.reload();
    await waitForEmployees(page, 3);
    await expect(page.getByTestId("list-panel")).toBeVisible();
    await expect(
      page.getByTestId("list-row").locator("visible=true"),
    ).toHaveCount(0);
  });

  test("an unfolded Went home today stays unfolded after a reload", async ({
    context,
    page,
  }) => {
    // Given one live conversation and one that went home today
    await seed([
      { sessionId: "a", deskName: "Task A", state: "idle", rank: "b" },
      {
        sessionId: "g",
        deskName: "Gone task",
        state: "wentHome",
        hadPrompt: true,
        endedAt: new Date(Date.now() - MIN),
      },
    ]);
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 1);
    const toggle = page.getByRole("button", { name: /^Went home today/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // When the owner unfolds it and reloads
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.reload();
    await waitForEmployees(page, 1);

    // Then it is still unfolded
    await expect(
      page.getByRole("button", { name: /^Went home today/ }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("went-home-list")).toBeVisible();
  });

  test("a new needs-you arrival reopens a folded Needs you, a reload does not, and a folded strip stays folded while its count grows", async ({
    context,
    page,
  }) => {
    // Given Needs you folded
    await twoWaiting();
    await signInAsOwner(context);
    await page.goto("/");
    await waitForEmployees(page, 3);
    await page.getByRole("button", { name: "Needs you", exact: true }).click();
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(0);
    await page.reload();
    await waitForEmployees(page, 3);
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(0);

    // When a conversation starts waiting for the owner
    await waitingArrives();

    // Then Needs you opens by itself and lists three
    await expect(
      page.getByTestId("needs-row").locator("visible=true"),
    ).toHaveCount(3, {
      timeout: 20_000,
    });

    // When the whole list is folded and another arrives
    await page.getByRole("button", { name: "Fold the list" }).click();
    await withE2eDb(async (db) => {
      await db.collection("sessions").updateOne(
        { sessionId: "i" },
        {
          $set: { state: "waitingForYou", stateSince: new Date() },
          $currentDate: { changedAt: true },
        },
      );
    });

    // Then the strip stays folded and its count follows
    await expect(page.getByTestId("list-folded-strip")).toHaveAttribute(
      "aria-label",
      "4 need you: open the list",
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("list-panel")).toHaveCount(0);
  });
});
