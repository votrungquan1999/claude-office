import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { signInAsOwner } from "./helpers";

// Local midnight is 17:00Z the day before in this zone, so "today" is fixed whatever the host's zone is.
test.use({
  viewport: { width: 1600, height: 1200 },
  hasTouch: false,
  timezoneId: "Asia/Ho_Chi_Minh",
});

test("the went-home list shows today's prompted departures only, opens details on click, and empties at local midnight", async ({
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
      state: "waiting",
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

    // Then one employee is in the office and the list shows exactly today's departure
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(1);
    const list = page.getByTestId("went-home-list");
    await expect(list.getByRole("listitem")).toHaveText([
      "Light the lantern · Studio Mac / today · 08:05",
    ]);

    // When the owner clicks the entry
    await list.getByRole("listitem").first().click();

    // Then the details show with no Remote Control link
    const panel = page.getByTestId("details-panel");
    await expect(panel).toContainText("Light the lantern");
    await expect(panel.getByTestId("folder")).toHaveText("~/projects/today");
    await expect(panel.getByTestId("state-pill")).toHaveText("Went home");
    await expect(panel).not.toContainText("Remote Control");
    await expect(panel.getByTestId("remote-control-link")).toHaveCount(0);

    // When the clock passes local midnight
    await page.clock.fastForward("14:00:00");

    // Then the list is empty and says so
    await expect(list.getByRole("listitem")).toHaveCount(0);
    await expect(list).toContainText("Nobody has gone home today");
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
