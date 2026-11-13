/**
 * Saves the README's pictures to docs/images from a made-up office on the e2e server (own port,
 * in-memory Mongo, own build dir). Run with `npm run capture`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { type Collection, MongoClient } from "mongodb";
import {
  E2E_BASE_URL,
  E2E_DB,
  E2E_MONGO_URI_FILE,
  E2E_PORT,
} from "../e2e/constants";
import {
  clickEmployee,
  employeeLabelled,
  type SeedSession,
  seedFolders,
  seedSessions,
  signInAsOwner,
  waitForEmployees,
} from "../e2e/helpers";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OUT = "docs/images";
const WORK = ".e2e/capture";
const MIN = 60_000;

const output: string[] = [];
let server: ChildProcess | undefined;
let stopShuffle: (() => void) | undefined;

/** Stops the e2e server; safe to call from every exit path. */
async function stopServer(): Promise<void> {
  const child = server;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Starts the e2e server with its output captured, and waits until the sign-in page answers. */
async function startServer(): Promise<void> {
  const taken = await fetch(`${E2E_BASE_URL}/sign-in`).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`port ${E2E_PORT} is already in use`);
  server = spawn(process.execPath, ["--import", "tsx", "e2e/serve.ts"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("the e2e server exited");
    const up = await fetch(`${E2E_BASE_URL}/sign-in`).then(
      (res) => res.ok,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("the e2e server did not start in time");
}

const STUDIO = { machineId: "studio", machineName: "Studio Mac" };
const AIR = { machineId: "air", machineName: "Travel Air" };
const HARBOR = "/Users/dev/code/harbor-labs";
const LUMEN = "/Users/dev/code/lumen-studio";
const ORCHARD = "/Users/dev/work/orchard";

const tag = (name: string) => ({ name, key: name.padEnd(12, "0") });
const API = tag("api");
const WEB = tag("web");
const DOCS = tag("docs");

/** One made-up employee; `changedAgo` is in minutes. */
function employee(
  sessionId: string,
  mac: typeof STUDIO,
  cwd: string,
  deskName: string,
  state: string,
  changedAgo: number,
  extra: Partial<SeedSession> & Record<string, unknown> = {},
): SeedSession & Record<string, unknown> {
  const now = Date.now();
  return {
    ...mac,
    sessionId,
    cwd,
    startCwd: cwd,
    deskName,
    state,
    startedAt: new Date(now - (changedAgo + 90) * MIN),
    changedAt: new Date(now - changedAgo * MIN),
    stateSince: new Date(now - changedAgo * MIN),
    ...extra,
  };
}

/** A busy office: Harbor Labs on the Studio Mac fills every room. */
function madeUpOffice() {
  const run = (text: string) => ({
    runningSteps: [{ text, startedAt: new Date(Date.now() - 20_000) }],
  });
  return [
    employee(
      "h1",
      STUDIO,
      `${HARBOR}/api`,
      "Add invoice export",
      "working",
      3,
      { tags: [API], ...run("Edit invoices.ts") },
    ),
    employee(
      "h2",
      STUDIO,
      `${HARBOR}/api`,
      "Fix flaky login test",
      "working",
      1,
      { tags: [API], ...run("Run npm test") },
    ),
    employee(
      "h3",
      STUDIO,
      `${HARBOR}/web`,
      "Dark mode for settings",
      "working",
      6,
      { tags: [WEB], ...run("Edit Settings.tsx") },
    ),
    employee(
      "h4",
      STUDIO,
      `${HARBOR}/web`,
      "Speed up the dashboard",
      "thinking",
      2,
      { tags: [WEB] },
    ),
    employee(
      "h5",
      STUDIO,
      `${HARBOR}/docs`,
      "Rewrite the quick start",
      "working",
      9,
      { tags: [DOCS], ...run("Read intro.md") },
    ),
    employee(
      "h6",
      STUDIO,
      `${HARBOR}/api`,
      "Migrate users table",
      "needsPermission",
      4,
      {
        tags: [API],
        currentTodo: "Run the migration",
        runningSteps: [
          { text: "Run db migrate", startedAt: new Date(Date.now() - 4 * MIN) },
        ],
        bridgeSessionId: "cse_demo1",
        recentSteps: [
          {
            id: "a1",
            text: "Read schema.sql",
            startedAt: new Date(Date.now() - 9 * MIN),
            durationMs: 300,
            status: "ok",
          },
          {
            id: "a2",
            text: "Edit 0042_users.sql",
            startedAt: new Date(Date.now() - 7 * MIN),
            durationMs: 1200,
            status: "ok",
          },
          {
            id: "a3",
            text: "Run npm test",
            startedAt: new Date(Date.now() - 6 * MIN),
            durationMs: 8400,
            status: "failed",
          },
          {
            id: "a4",
            text: "Edit 0042_users.sql",
            startedAt: new Date(Date.now() - 5 * MIN),
            durationMs: 900,
            status: "ok",
          },
        ],
      },
    ),
    employee(
      "h7",
      STUDIO,
      `${HARBOR}/web`,
      "Delete the old checkout",
      "needsPermission",
      2,
      { tags: [WEB], ...run("Run rm -rf legacy") },
    ),
    employee(
      "h8",
      STUDIO,
      `${HARBOR}/api`,
      "Which payment provider?",
      "waitingForYou",
      11,
      { tags: [API] },
    ),
    employee(
      "h9",
      STUDIO,
      `${HARBOR}/web`,
      "Pick a chart library",
      "waitingForYou",
      14,
      { tags: [WEB] },
    ),
    employee(
      "h10",
      STUDIO,
      `${HARBOR}/docs`,
      "Review the FAQ draft",
      "waitingForYou",
      20,
      { tags: [DOCS] },
    ),
    employee(
      "h11",
      STUDIO,
      `${HARBOR}/api`,
      "Rename the billing module",
      "waitingForYou",
      33,
      { tags: [API] },
    ),
    employee(
      "h12",
      STUDIO,
      `${HARBOR}/web`,
      "Fix the mobile menu",
      "idle",
      25,
      { tags: [WEB] },
    ),
    employee(
      "h13",
      STUDIO,
      `${HARBOR}/api`,
      "Cache the price list",
      "idle",
      41,
      { tags: [API] },
    ),
    employee(
      "h14",
      STUDIO,
      `${HARBOR}/docs`,
      "Add a changelog page",
      "idle",
      52,
      { tags: [DOCS] },
    ),
    employee("h15", STUDIO, `${HARBOR}/web`, "Tidy the footer", "idle", 61),
    employee("h16", STUDIO, HARBOR, "Plan the Q3 roadmap", "idle", 75),
    employee(
      "h17",
      STUDIO,
      `${HARBOR}/api`,
      "Audit the signup emails",
      "review",
      15,
      { tags: [API] },
    ),
    employee(
      "l1",
      STUDIO,
      `${LUMEN}/site`,
      "Hero image on the home page",
      "working",
      5,
    ),
    employee(
      "l2",
      STUDIO,
      `${LUMEN}/site`,
      "Contact form spam filter",
      "waitingForYou",
      8,
    ),
    employee(
      "o1",
      AIR,
      `${ORCHARD}/app`,
      "Offline mode for the app",
      "working",
      7,
    ),
    employee(
      "o2",
      AIR,
      `${ORCHARD}/app`,
      "Crash on startup",
      "needsPermission",
      3,
    ),
    employee(
      "o3",
      AIR,
      `${ORCHARD}/app`,
      "Update the privacy text",
      "idle",
      30,
    ),
    employee(
      "w1",
      STUDIO,
      `${HARBOR}/api`,
      "Bump dependencies",
      "wentHome",
      150,
      { tags: [API], endedAt: new Date(Date.now() - 140 * MIN) },
    ),
  ] as SeedSession[];
}

/** Moves a few employees between states every so often, so they walk between rooms. */
function startShuffle(sessions: Collection) {
  const moves: Array<[string, string]> = [
    ["h8", "working"],
    ["h2", "waitingForYou"],
    ["h12", "working"],
    ["h5", "idle"],
    ["h4", "waitingForYou"],
    ["h13", "working"],
    ["h6", "working"],
    ["h1", "idle"],
  ];
  let i = 0;
  const timer = setInterval(() => {
    const [sessionId, state] = moves[i++ % moves.length];
    void sessions.updateOne(
      { sessionId },
      { $set: { state, changedAt: new Date(), stateSince: new Date() } },
    );
  }, 1200);
  return () => clearInterval(timer);
}

/** Runs ffmpeg and fails loudly with its own output. */
function ffmpeg(...args: string[]) {
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });
}

/** Seeds the office, takes every picture and writes them to docs/images. */
async function capture() {
  mkdirSync(OUT, { recursive: true });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const mongo = new MongoClient(
    readFileSync(E2E_MONGO_URI_FILE, "utf8").trim(),
  );
  await mongo.connect();
  const db = mongo.db(E2E_DB);
  const browser = await chromium.launch();
  try {
    const now = new Date();
    await db.collection("machines").deleteMany({});
    await db.collection("machines").insertMany([
      {
        machineId: STUDIO.machineId,
        machineName: STUDIO.machineName,
        lastSeenAt: now,
      },
      {
        machineId: AIR.machineId,
        machineName: AIR.machineName,
        lastSeenAt: now,
      },
    ]);
    await seedFolders(db.collection("folders"), [
      { machineId: "studio", path: HARBOR },
      { machineId: "studio", path: LUMEN },
      { machineId: "air", path: ORCHARD },
    ]);
    const sessions = db.collection("sessions");
    await seedSessions(sessions, madeUpOffice());

    // Desktop office, then the details panel on the session that needs permission.
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await signInAsOwner(desktop);
    const page = await desktop.newPage();
    await page.goto(E2E_BASE_URL);
    await waitForEmployees(page, 17);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/office-desktop.png` });
    const id = await employeeLabelled(page, "Migrate users table");
    await clickEmployee(page, id);
    const panel = page.getByTestId("details-panel");
    await panel.waitFor();
    await page.waitForTimeout(500);
    await panel.screenshot({ path: `${OUT}/details-panel.png` });
    await desktop.close();

    // Phone, portrait.
    const phone = await browser.newContext({
      ...devices["iPhone 15"],
      // 3x makes the fit zoom 2, so the office fills the width; a screen only as tall as the office leaves no empty bands.
      deviceScaleFactor: 3,
      viewport: { width: 393, height: 480 },
    });
    await signInAsOwner(phone);
    const phonePage = await phone.newPage();
    await phonePage.goto(E2E_BASE_URL);
    await waitForEmployees(phonePage, 17);
    await phonePage.waitForTimeout(4000);
    await phonePage.screenshot({ path: `${OUT}/office-phone.png` });
    await phone.close();

    // Walking GIF: record while employees change state.
    stopShuffle = startShuffle(sessions);
    const video = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      recordVideo: { dir: WORK, size: { width: 1280, height: 800 } },
    });
    await signInAsOwner(video);
    const videoPage = await video.newPage();
    await videoPage.goto(E2E_BASE_URL);
    await waitForEmployees(videoPage, 17);
    await videoPage.waitForTimeout(11_000);
    const webm = await videoPage.video()?.path();
    await video.close();
    stopShuffle();
    stopShuffle = undefined;
    if (!webm) throw new Error("no video was recorded");
    renameSync(webm, `${WORK}/walk.webm`);
    const filters = "fps=10,scale=800:-1:flags=lanczos";
    ffmpeg(
      "-ss",
      "1",
      "-t",
      "9",
      "-i",
      `${WORK}/walk.webm`,
      "-vf",
      `${filters},palettegen=max_colors=128`,
      `${WORK}/palette.png`,
    );
    ffmpeg(
      "-ss",
      "1",
      "-t",
      "9",
      "-i",
      `${WORK}/walk.webm`,
      "-i",
      `${WORK}/palette.png`,
      "-lavfi",
      `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
      `${OUT}/office-walking.gif`,
    );

    // Social preview: the middle of the desktop shot.
    ffmpeg(
      "-i",
      `${OUT}/office-desktop.png`,
      "-vf",
      "crop=1280:640:0:80",
      "-frames:v",
      "1",
      `${OUT}/social-preview.png`,
    );
  } finally {
    // A failure mid-recording must not leave the shuffle timer keeping the process alive.
    stopShuffle?.();
    await browser.close();
    await mongo.close();
  }
}

let failed = false;
try {
  await startServer();
  await capture();
  console.log(`saved pictures to ${path.resolve(OUT)}`);
} catch (error) {
  failed = true;
  console.error("capture failed:", error);
  console.error(`--- e2e server output ---\n${output.join("")}`);
} finally {
  await stopServer();
}
process.exit(failed ? 1 : 0);
