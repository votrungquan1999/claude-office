import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  employeeLabelled,
  keepOneCompany,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

keepOneCompany("m1", "/Users/q");

// The canvas and its labels are not drawn on a phone, which shows stacked rooms.
test.use({ viewport: { width: 1600, height: 1200 }, hasTouch: false });

const ROOMS = ["working", "needsPermission", "waitingForYou", "review", "idle"];
const SEATS: Record<string, number> = {
  working: 24,
  needsPermission: 12,
  waitingForYou: 12,
  review: 12,
  idle: 12,
};

test("the owner sees an office with five labelled rooms", async ({
  context,
  page,
}) => {
  // Given the owner is signed in
  await signInAsOwner(context);

  // When the office opens
  await page.goto("/");

  // Then each room has a sign
  await expect(page.getByTestId("room-sign")).toHaveCount(5);
  const rooms = await page
    .getByTestId("room-sign")
    .evaluateAll((signs) =>
      signs.map((sign) => sign.getAttribute("data-room")),
    );
  expect(rooms).toEqual(ROOMS);
  await expect(page.getByTestId("room-sign").first()).toHaveText("Working");
  await expect(page.getByTestId("room-sign").nth(2)).toHaveText(
    "Waiting for you",
  );

  // And the scene has the five areas, each with seats an employee can take
  const areas = await page.evaluate(() =>
    window.__officeTestHooks?.getAreas().map((area) => area.label),
  );
  expect(areas).toEqual(ROOMS);
  const seats = await page.evaluate(
    () => window.__officeTestHooks?.getSeats() ?? [],
  );
  for (const room of ROOMS) {
    expect(seats.filter((seat) => seat.areaLabel === room).length).toBe(
      SEATS[room],
    );
  }
});

test("idle, waiting-for-you and thinking sessions each sit in their own room, thinking inside Working", async ({
  context,
  page,
}) => {
  // Given one session each in the idle, waiting-for-you and thinking states
  const client = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await client.connect();
  const sessions = client.db(E2E_DB).collection("sessions");
  await sessions.deleteMany({});
  const states = ["idle", "waitingForYou", "thinking"];
  await sessions.insertMany(
    states.map((state, i) => ({
      machineId: "m1",
      machineName: "Studio Mac",
      sessionId: `s${i}`,
      cwd: `/Users/q/projects/p${i}`,
      state,
      startedAt: new Date(),
      changedAt: new Date(1000 + i),
    })),
  );
  await signInAsOwner(context);

  try {
    // When the office opens
    await page.goto("/");
    await waitForEmployees(page, 3);

    // Then each employee is seated in the room of its state
    const expected = [
      ["p0", "idle"],
      ["p1", "waitingForYou"],
      ["p2", "working"],
    ];
    for (const [project, room] of expected) {
      const id = await employeeLabelled(page, project);
      await expect
        .poll(async () => {
          const seats = await page.evaluate(
            () => window.__officeTestHooks?.getAgentSeats() ?? [],
          );
          return seats.find((seat) => seat.id === id)?.areaLabel;
        })
        .toBe(room);
    }
  } finally {
    await sessions.deleteMany({});
    await client.close();
  }
});
