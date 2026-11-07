import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

const ROOMS = ["working", "thinking", "needsPermission", "waiting"];
const MIN_SEATS_PER_ROOM = 10;

test("the owner sees an office with four labelled rooms", async ({
  context,
  page,
}) => {
  // Given the owner is signed in
  await signInAsOwner(context);

  // When the office opens
  await page.goto("/");

  // Then each room has a sign
  await expect(page.getByTestId("room-sign")).toHaveCount(4);
  const rooms = await page
    .getByTestId("room-sign")
    .evaluateAll((signs) =>
      signs.map((sign) => sign.getAttribute("data-room")),
    );
  expect(rooms).toEqual(ROOMS);
  await expect(page.getByTestId("room-sign").first()).toHaveText("Working");

  // And the scene has the four areas, each with seats an employee can take
  const areas = await page.evaluate(() =>
    window.__officeTestHooks?.getAreas().map((area) => area.label),
  );
  expect(areas).toEqual(ROOMS);
  const seats = await page.evaluate(
    () => window.__officeTestHooks?.getSeats() ?? [],
  );
  for (const room of ROOMS) {
    expect(
      seats.filter((seat) => seat.areaLabel === room).length,
    ).toBeGreaterThanOrEqual(MIN_SEATS_PER_ROOM);
  }
});
