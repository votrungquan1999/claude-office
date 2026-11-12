import { readFileSync } from "node:fs";
import {
  type APIResponse,
  expect,
  type Page,
  type Route,
  test,
} from "@playwright/test";
import { MongoClient } from "mongodb";
import { E2E_BASE_URL, E2E_DB, E2E_MONGO_URI_FILE } from "./constants";
import {
  employeeLabelled,
  hoverEmployee,
  seedFolders,
  seedOnlineMachine,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
} from "./helpers";

/** The company tab names in the strip, in order. */
const tabNames = (page: Page) =>
  page
    .getByTestId("company-tab")
    .evaluateAll((tabs) =>
      tabs.map((tab) => (tab as HTMLElement).dataset.companyName),
    );

test.describe("renaming a company", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("naming a company in All companies shows the new name in the bar and the drawer on this device and on a phone, in its sorted place, with one request", async ({
    browser,
    context,
    page,
  }) => {
    // Given two companies on one Mac, and a phone that already has the office open
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha" },
      { machineId: "air", path: "/Users/q/bravo" },
    ]);
    await seedOnlineMachine("air", "Air");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      ["alpha", "bravo"].map((name) => ({
        sessionId: name,
        machineId: "air",
        machineName: "Air",
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/office/folders/display-name"))
        requests.push(request.postData() ?? "");
    });
    const phoneContext = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await signInAsOwner(phoneContext);
    const phone = await phoneContext.newPage();

    try {
      await page.goto("/");
      await expect.poll(() => tabNames(page)).toEqual(["alpha", "bravo"]);
      await phone.goto("/");
      await expect.poll(() => tabNames(phone)).toEqual(["alpha", "bravo"]);

      // When the owner renames alpha to Zulu from its pencil in All companies
      await page.getByTestId("open-drawer").click();
      const drawer = page.getByRole("dialog", { name: "All companies" });
      await drawer.getByRole("button", { name: "Rename alpha" }).click();
      await drawer.getByLabel("Name for folder alpha").fill("Zulu");
      await drawer.getByRole("button", { name: "Save" }).click();

      // Then this device shows Zulu in the drawer and in the bar, sorted after bravo, after one request
      await expect(drawer.getByTestId("drawer-company-Zulu")).toBeVisible();
      await expect.poll(() => tabNames(page)).toEqual(["bravo", "Zulu"]);
      expect(requests).toHaveLength(1);

      // And the renamed company's employee label on the canvas carries the new name
      await waitForEmployees(page, 1);
      const renamedEmployee = await employeeLabelled(page, "Zulu");
      await hoverEmployee(page, renamedEmployee);
      await expect(page.getByTestId("agent-overlay").first()).toContainText(
        "Zulu",
      );

      // And the phone shows it too once its next poll arrives
      await expect
        .poll(() => tabNames(phone), { timeout: 15_000 })
        .toEqual(["bravo", "Zulu"]);
      await phone.getByTestId("open-drawer").click();
      await expect(phone.getByTestId("drawer-company-Zulu")).toBeVisible();
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await phoneContext.close();
      await client.close();
    }
  });

  test("a name the server stored gives way to the name another device saved", async ({
    context,
    page,
  }) => {
    // Given two companies, and the server will answer 200 to a rename without storing it
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha" },
      { machineId: "air", path: "/Users/q/bravo" },
    ]);
    await seedOnlineMachine("air", "Air");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      ["alpha", "bravo"].map((name) => ({
        sessionId: name,
        machineId: "air",
        machineName: "Air",
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);
    await page.route("**/api/office/folders/display-name", (route) =>
      route.fulfill({ status: 200, body: "{}" }),
    );

    try {
      await page.goto("/");
      await expect.poll(() => tabNames(page)).toEqual(["alpha", "bravo"]);

      // When the owner renames alpha to Zulu and another device has already saved Dock
      await db
        .collection("folders")
        .updateOne(
          { path: "/Users/q/alpha" },
          { $set: { displayName: "Dock" } },
        );
      await page
        .getByTestId("company-tab")
        .filter({ hasText: "alpha" })
        .dblclick();
      await page.getByLabel("Name for folder alpha").fill("Zulu");
      await page.keyboard.press("Enter");

      // Then the bar ends up showing the server's name, not this device's
      await expect
        .poll(() => tabNames(page), { timeout: 15_000 })
        .toEqual(["bravo", "Dock"]);
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });

  test("a stored name stays when a poll read before the save answers after it, and a later poll settles it", async ({
    context,
    page,
  }) => {
    // Given two companies on one Mac
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha" },
      { machineId: "air", path: "/Users/q/bravo" },
    ]);
    await seedOnlineMachine("air", "Air");
    const sessions = db.collection("sessions");
    await seedSessions(
      sessions,
      ["alpha", "bravo"].map((name) => ({
        sessionId: name,
        machineId: "air",
        machineName: "Air",
        cwd: `/Users/q/${name}`,
        startCwd: `/Users/q/${name}`,
      })),
    );
    await signInAsOwner(context);

    try {
      await page.goto("/");
      await expect.poll(() => tabNames(page)).toEqual(["alpha", "bravo"]);

      // And a poll that has read the old name is held on the wire, and the poll after it is held before it reaches the server
      let stalePoll: { route: Route; response: APIResponse } | undefined;
      let nextPoll: Route | undefined;
      await page.route(
        (url) => url.pathname === "/api/office/changes",
        async (route) => {
          if (!stalePoll) stalePoll = { route, response: await route.fetch() };
          else if (!nextPoll) nextPoll = route;
          else await route.continue();
        },
      );
      await expect.poll(() => stalePoll !== undefined).toBe(true);

      // When the owner renames alpha to Zulu and the server stores it
      const stored = page.waitForResponse("**/api/office/folders/display-name");
      await page
        .getByTestId("company-tab")
        .filter({ hasText: "alpha" })
        .dblclick();
      await page.getByLabel("Name for folder alpha").fill("Zulu");
      await page.keyboard.press("Enter");
      expect((await stored).status()).toBe(200);

      // And the held poll then answers with the old name
      await stalePoll?.route.fulfill({ response: stalePoll.response });
      await expect
        .poll(() => nextPoll !== undefined, { timeout: 10_000 })
        .toBe(true);

      // Then the tab still shows Zulu
      expect(await tabNames(page)).toEqual(["bravo", "Zulu"]);

      // And once a later poll has answered, a name another device saves shows, so Zulu is no longer held
      const settled = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/office/changes",
      );
      await nextPoll?.continue();
      await settled;
      expect(await tabNames(page)).toEqual(["bravo", "Zulu"]);
      await db
        .collection("folders")
        .updateOne(
          { path: "/Users/q/alpha" },
          { $set: { displayName: "Dock" } },
        );
      await expect
        .poll(() => tabNames(page), { timeout: 15_000 })
        .toEqual(["bravo", "Dock"]);
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });

  test("a 100-character name is cut short in the bar and shown in full on hover", async ({
    context,
    page,
  }) => {
    // Given a company already named with 100 characters
    const client = new MongoClient(
      readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
    );
    await client.connect();
    const db = client.db(E2E_DB);
    const long = "N".repeat(100);
    await seedFolders(db.collection("folders"), [
      { machineId: "air", path: "/Users/q/alpha", displayName: long },
    ]);
    await seedOnlineMachine("air", "Air");
    const sessions = db.collection("sessions");
    await seedSessions(sessions, [
      {
        sessionId: "alpha",
        machineId: "air",
        machineName: "Air",
        cwd: "/Users/q/alpha",
        startCwd: "/Users/q/alpha",
      },
    ]);
    await signInAsOwner(context);

    try {
      // When the office loads
      await page.goto("/");
      const tab = page.getByTestId("company-tab");

      // Then the tab stays narrow and its hover text is the full name
      await expect(tab).toHaveAttribute("title", long);
      const box = await tab.boundingBox();
      expect(box?.width).toBeLessThan(450);
    } finally {
      await seedFolders(db.collection("folders"), []);
      await db.collection("machines").deleteMany({});
      await sessions.deleteMany({});
      await client.close();
    }
  });
});
