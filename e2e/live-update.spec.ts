import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { signInAsOwner } from "./helpers";

test("a session written to the database while the office is open appears, and a later change relabels it, without a reload", async ({
  context,
  page,
}) => {
  // Given an open office with no sessions
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await signInAsOwner(context);

  try {
    // The first load has to be over, or the new session could ride along with it.
    const firstLoad = page.waitForResponse((response) =>
      response.url().includes("/api/office/changes"),
    );
    await page.goto("/");
    await firstLoad;
    await expect(page.getByTestId("agent-overlay")).toHaveCount(0);

    // When an agent writes a new session
    await sessions.insertOne({
      machineId: "live-machine",
      machineName: "Live Mac",
      sessionId: "live-1",
      cwd: "/Users/q/projects/first",
      state: "waiting",
      startedAt: new Date(),
      changedAt: new Date(),
    });

    // Then its employee shows up within a few seconds
    await expect(page.getByTestId("agent-overlay")).toContainText(
      "Live Mac / first",
      { timeout: 8000 },
    );

    // When the session moves to another folder
    await sessions.updateOne(
      { sessionId: "live-1" },
      {
        $set: { cwd: "/Users/q/projects/second" },
        $currentDate: { changedAt: true },
      },
    );

    // Then the same employee is relabelled
    await expect(page.getByTestId("agent-overlay")).toContainText(
      "Live Mac / second",
      { timeout: 8000 },
    );
    await expect(page.getByTestId("agent-overlay")).toHaveCount(1);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
