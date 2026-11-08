import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { signInAsOwner, waitForEmployees } from "./helpers";

test("a session stored for a Mac shows up as an employee labelled with the machine and folder", async ({
  context,
  page,
}) => {
  // Given a session the agent of some Mac stored
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertOne({
    machineId: "e2e-machine",
    machineName: "Studio Mac",
    sessionId: "e2e-session",
    cwd: "/Users/q/projects/lantern",
    state: "waiting",
    startedAt: new Date(),
    changedAt: new Date(),
  });
  await signInAsOwner(context);

  try {
    // When the owner opens the office
    await page.goto("/");

    // Then one employee is in the scene, labelled with the machine and the folder once selected
    await waitForEmployees(page, 1);
    await page.evaluate(() => {
      const id = window.__officeTestHooks?.getCharacters()[0].id ?? -1;
      window.__officeTestHooks?.selectAgent(id);
    });
    await expect(page.getByTestId("agent-overlay")).toContainText(
      "Studio Mac / lantern",
    );
    expect(
      await page.evaluate(
        () => window.__officeTestHooks?.getCharacters().length,
      ),
    ).toBe(1);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
