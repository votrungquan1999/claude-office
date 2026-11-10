import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  clickEmployee,
  keepOneCompany,
  seedSessions,
  signInAsOwner,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

test("a kept employee whose window closed stays in the office, and its details say 'Not running' with no Remote Control and no extra text on the desk", async ({
  context,
  page,
}) => {
  // Given a hired employee whose window closed a few minutes ago
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await seedSessions(sessions, [
    {
      sessionId: "closed",
      deskName: "Light the lantern",
      cwd: "/Users/q/projects/lantern",
      kept: "hired",
      bridgeSessionId: "bridge-closed",
      notRunning: true,
      stateSince: new Date(Date.now() - 4 * 60_000),
    },
  ]);
  await signInAsOwner(context);

  try {
    // When the owner opens the office and selects it
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(() => window.__officeTestHooks?.getCharacters().length),
      )
      .toBe(1);
    await clickEmployee(page, 1);

    // Then the details show "Not running" with the time, no Remote Control and no terminal box
    const panel = page.getByTestId("details-panel");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
      "Light the lantern",
    );
    await expect(panel.getByTestId("state-pill")).toHaveText("Not running");
    await expect(panel.getByTestId("state-time")).toHaveText(/ · [34]m/);
    await expect(panel.getByTestId("state-band")).toHaveCSS(
      "background-color",
      "rgb(90, 90, 106)",
    );
    await expect(panel).not.toContainText("Remote Control");
    await expect(panel.getByTestId("remote-control-link")).toHaveCount(0);
    await expect(panel.getByTestId("terminal-box")).toHaveCount(0);

    // And the went-home list does not hold it
    await expect(
      page.getByTestId("went-home-list").getByRole("listitem"),
    ).toHaveCount(0);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
