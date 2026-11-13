import { expect, test } from "@playwright/test";
import {
  keepOneCompany,
  openWentHome,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
  withE2eDb,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// Local midnight is 17:00Z the day before in this zone, so "today" is fixed whatever the host's zone is.
test.use({
  viewport: { width: 1600, height: 1200 },
  hasTouch: false,
  timezoneId: "Asia/Ho_Chi_Minh",
});

/** One live employee and one prompted departure on Nov 8. */
async function seedLiveAndDeparture() {
  const startedAt = new Date("2026-11-07T01:00:00.000Z");
  await withE2eDb((db) =>
    seedSessions(db.collection("sessions"), [
      {
        sessionId: "live",
        deskName: "Paint the fence",
        cwd: "/Users/q/projects/live",
        startedAt,
      },
      {
        sessionId: "today",
        deskName: "Light the lantern",
        cwd: "/Users/q/projects/today",
        state: "wentHome",
        hadPrompt: true,
        startedAt,
        endedAt: new Date("2026-11-08T01:05:00.000Z"),
      },
    ]),
  );
}

test.afterEach(async () => {
  await withE2eDb(async (db) => {
    await db.collection("sessions").deleteMany({});
  });
});

test("the Went home today count reads 0 and the section says nobody has gone home when local midnight passes", async ({
  context,
  page,
}) => {
  // Given one prompted departure today, 10:00 on Nov 8 in the browser's zone
  await withE2eDb((db) =>
    seedSessions(db.collection("sessions"), [
      {
        sessionId: "today",
        cwd: "/Users/q/projects/today",
        state: "wentHome",
        hadPrompt: true,
        startedAt: new Date("2026-11-07T01:00:00.000Z"),
        endedAt: new Date("2026-11-08T01:05:00.000Z"),
      },
    ]),
  );
  await signInAsOwner(context);
  await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^Went home today/ });
  await expect(toggle).toHaveText(/Went home today\s*1$/);

  // When the clock passes local midnight
  await page.clock.fastForward("14:00:00");

  // Then the count reads 0 and the section says nobody has gone home
  await expect(toggle).toHaveText(/Went home today\s*0$/);
  const list = await openWentHome(page);
  await expect(list.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByTestId("list-panel")).toContainText(
    "Nobody has gone home today",
  );
});

test.describe("on a touch tablet", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("a tapped departure opens its details sheet over the office, and closing the details leaves the section open", async ({
    context,
    page,
  }) => {
    // Given one live employee and one departure today
    await seedLiveAndDeparture();
    await signInAsOwner(context);
    await page.clock.install({ time: new Date("2026-11-08T03:00:00.000Z") });
    await page.goto("/");
    await waitForEmployees(page, 1);

    // When the owner unfolds Went home today and taps the departure
    const list = await openWentHome(page);
    await list.getByRole("listitem").tap();

    // Then the details sheet shows, as Went home, with no Remote Control link
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText("Light the lantern");
    await expect(panel.getByTestId("state-pill")).toHaveText("Went home");
    await expect(panel.getByTestId("remote-control-link")).toHaveCount(0);

    // When the owner closes the details
    await panel.getByRole("button", { name: /close/i }).tap();

    // Then the section is still open
    await expect(panel).toHaveCount(0);
    await expect(list).toBeVisible();
  });
});
