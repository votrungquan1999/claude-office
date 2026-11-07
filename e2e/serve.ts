/**
 * The e2e server: an in-memory Mongo, a seeded owner session, then `next dev` on its own port and
 * build dir. Playwright starts the web server before globalSetup, so this wrapper owns the database
 * too. Run with `node --import tsx e2e/serve.ts`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { MongoMemoryReplSet } from "mongodb-memory-server";
import { closeMongo } from "../src/db/mongo";
import { resetAuth } from "../src/lib/auth";
import { createReplSet } from "../src/test/create-repl-set";
import {
  SESSION_COOKIE_NAME,
  sessionHeadersFor,
} from "../src/test/owner-session";
import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_DB,
  E2E_DIST_DIR,
  E2E_MONGO_URI_FILE,
  E2E_OWNER_COOKIE_FILE,
  E2E_OWNER_EMAIL,
  E2E_PORT,
} from "./constants";

const HOMEBREW_MONGOD = "/opt/homebrew/bin/mongod";

let replSet: MongoMemoryReplSet | undefined;
let server: ChildProcess | undefined;
let stopping = false;

/**
 * Sends SIGTERM and waits for the child to exit, falling back to SIGKILL after 5 s.
 * @param child - The process to stop.
 */
async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Stops the app, then Mongo; safe to call from every exit path.
 * @param code - The exit code.
 */
async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopChild(server);
  await closeMongo().catch(() => {});
  await replSet?.stop().catch((error) => console.error(error));
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => void shutdown(0));
}

try {
  // vitest's setup does not run here, so the system mongod is picked up explicitly.
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync(HOMEBREW_MONGOD)) {
    process.env.MONGOMS_SYSTEM_BINARY = HOMEBREW_MONGOD;
  }
  // The browser loads these indexes; they are generated, not committed.
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/build-office-assets.ts"],
    {
      stdio: "inherit",
    },
  );
  replSet = await createReplSet();

  // Every variable the app reads is set explicitly, so a developer's exports can't leak in.
  const appEnv = {
    BETTER_AUTH_URL: E2E_BASE_URL,
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    ALLOWED_EMAIL: E2E_OWNER_EMAIL,
    GOOGLE_CLIENT_ID: "e2e-google-id",
    GOOGLE_CLIENT_SECRET: "e2e-google-secret",
    MONGODB_URI: replSet.getUri(),
    MONGODB_DB: E2E_DB,
  };
  Object.assign(process.env, appEnv);

  // Seed the owner through better-auth, then hand the cookie and database address to the specs.
  const headers = await sessionHeadersFor(E2E_OWNER_EMAIL);
  const cookie = headers?.get("cookie") ?? "";
  const value = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);
  mkdirSync(".e2e", { recursive: true });
  writeFileSync(
    E2E_OWNER_COOKIE_FILE,
    JSON.stringify({ name: SESSION_COOKIE_NAME, value }),
  );
  writeFileSync(E2E_MONGO_URI_FILE, replSet.getUri());
  resetAuth();
  await closeMongo();

  const env = {
    ...process.env,
    ...appEnv,
    PORT: String(E2E_PORT),
    NEXT_DIST_DIR: E2E_DIST_DIR,
    NEXT_PUBLIC_E2E: "1",
  };
  // Run next's own entry with this node, so SIGTERM reaches the server itself and not an npx shim.
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(E2E_PORT)], {
    stdio: "inherit",
    detached: false,
    env,
  });
  server.on("error", (error) => {
    console.error("e2e server failed to spawn:", error);
    void shutdown(1);
  });
  server.on("exit", (code) => void shutdown(code ?? 1));
} catch (error) {
  console.error("e2e server failed to start:", error);
  await shutdown(1);
}
