import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import { signInAsOwner, waitForEmployees } from "./helpers";

test("a room with more sessions than seats shows its count against its seats on the sign, and a room under capacity shows only its name", async ({
  context,
  page,
}) => {
  // Given 14 sessions needing permission (the room has 12 seats) and one idle session
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  await sessions.insertMany(
    Array.from({ length: 15 }, (_, i) => ({
      machineId: "m1",
      machineName: "Studio Mac",
      sessionId: `s${i}`,
      cwd: `/Users/q/projects/p${i}`,
      state: i < 14 ? "needsPermission" : "idle",
      startedAt: new Date(),
      changedAt: new Date(1000 + i),
    })),
  );
  await signInAsOwner(context);

  try {
    // When the office opens
    await page.goto("/");
    await waitForEmployees(page, 15);

    // Then the Needs permission sign reads "14 / 12" and the Idle sign shows its name only
    const sign = (room: string) =>
      page.locator(`[data-testid="room-sign"][data-room="${room}"]`);
    await expect(sign("needsPermission")).toHaveText(
      "Needs permission 14 / 12",
    );
    // And the longest sign still fits inside the phone's screen
    const box = await sign("needsPermission").boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await expect(sign("idle")).toHaveText("Idle");
    await expect(sign("working")).toHaveText("Working");

    // And two of the 14 have no seat
    const seatless = await page.evaluate(
      () =>
        window.__officeTestHooks
          ?.getCharacters()
          .filter((ch) => ch.seatId === null).length,
    );
    expect(seatless).toBe(2);
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
