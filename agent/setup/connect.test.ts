import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/connect/approve/route";
import { POST as collect } from "@/app/api/connect/collect/route";
import { POST as create } from "@/app/api/connect/route";
import { getDb } from "@/db/mongo";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { type FakeHome, makeFakeHome } from "../test/fake-home";
import { connectMac } from "./connect";

const OWNER = "owner@example.com";
const APP_URL = "http://localhost:4710";

const handlers: Record<string, (request: NextRequest) => Promise<Response>> = {
  "/api/connect": create,
  "/api/connect/collect": collect,
};

/** A fetch that calls the app's route handlers in-process. */
const fetchRoutes: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const handler = handlers[url.pathname];
  if (!handler) throw new Error(`no route for ${url.pathname}`);
  return handler(
    new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]),
  );
};

describe("connecting this Mac from the setup command", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  let fake: FakeHome;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    fake = makeFakeHome("m-connect");
    await (await getDb()).collection("connectCodes").deleteMany({});
  });
  afterEach(() => fake.remove());

  /** The owner's browser: opening the link approves the code it carries. */
  async function ownerClicks(url: string): Promise<void> {
    const userCode = new URL(url).searchParams.get("code");
    await approve(
      new NextRequest(`${APP_URL}/api/connect/approve`, {
        method: "POST",
        headers: new Headers({
          cookie: ownerHeaders.get("cookie") ?? "",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ userCode }),
      }),
    );
  }

  function run(overrides: Partial<Parameters<typeof connectMac>[0]> = {}) {
    const printed: string[] = [];
    const opened: string[] = [];
    const done = connectMac({
      home: fake.home,
      appUrl: APP_URL,
      computerName: "Quan's MacBook",
      openUrl: async (url) => {
        opened.push(url);
        await ownerClicks(url);
      },
      print: (line) => printed.push(line),
      fetch: fetchRoutes,
      sleep: async () => {},
      ...overrides,
    });
    return { done, printed, opened };
  }

  it("prints the link and code, opens the browser, and saves the connection privately without printing it", async () => {
    // Given a Mac whose umask would leave new files readable by others
    const oldUmask = process.umask(0o000);
    // And an office folder already there with loose permissions
    mkdirSync(join(fake.home, ".claude-office"), { mode: 0o755 });
    try {
      // When setup connects it and the owner clicks
      const { done, printed, opened } = run();
      await done;

      // Then the browser was sent to the link and the terminal shows the same link and the code
      expect(opened).toHaveLength(1);
      const code = new URL(opened[0]).searchParams.get("code") ?? "";
      const screen = printed.join("\n");
      expect(screen).toContain(opened[0]);
      expect(screen).toContain(`${code.slice(0, 4)}-${code.slice(4)}`);

      // And the connection is saved, private to this user, and never shown
      const dir = join(fake.home, ".claude-office");
      const file = join(dir, "config.json");
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        mongodbUri: process.env.MONGODB_URI,
        mongodbDb: process.env.MONGODB_DB,
      });
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(screen).not.toContain(process.env.MONGODB_URI ?? "never");
    } finally {
      process.umask(oldUmask);
    }
  });

  it("skips the approval when a valid connection is already saved", async () => {
    // Given a saved, well-formed config
    const dir = join(fake.home, ".claude-office");
    mkdirSync(dir, { recursive: true });
    const saved = JSON.stringify({
      mongodbUri: "mongodb://old",
      mongodbDb: "old",
    });
    writeFileSync(join(dir, "config.json"), saved);

    // When setup runs again without asking to reconnect
    const { done, printed, opened } = run({
      fetch: async () => {
        throw new Error("the office must not be contacted");
      },
    });
    await done;

    // Then no browser opens, the config is untouched, and the owner is told how to reconnect
    expect(opened).toEqual([]);
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(saved);
    expect(printed.join("\n")).toContain("--reconnect");
  });

  it("replaces an earlier connection when run again with reconnect", async () => {
    // Given an old config from an earlier setup
    const dir = join(fake.home, ".claude-office");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ mongodbUri: "mongodb://old", mongodbDb: "old" }),
    );

    // When setup runs again with reconnect
    await run({ reconnect: true }).done;

    // Then the new connection replaced it and it is still private
    const file = join(dir, "config.json");
    expect(JSON.parse(readFileSync(file, "utf8")).mongodbDb).toBe(
      process.env.MONGODB_DB,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps the owner's Anthropic key when it replaces the connection", async () => {
    // Given an old config that also holds the owner's key
    const dir = join(fake.home, ".claude-office");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        mongodbUri: "mongodb://old",
        mongodbDb: "old",
        anthropicApiKey: "sk-test-keep-me",
      }),
    );

    // When setup runs again with reconnect
    await run({ reconnect: true }).done;

    // Then the connection is new and the key is still there
    const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(saved.mongodbDb).toBe(process.env.MONGODB_DB);
    expect(saved.anthropicApiKey).toBe("sk-test-keep-me");
  });

  it("keeps waiting while the owner has not clicked, and gives up with the old config untouched when the code expires", async () => {
    // Given an old config and an owner who never clicks
    const dir = join(fake.home, ".claude-office");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), '{"keep":"me"}');
    let clock = Date.now();

    // When time passes beyond the code's life
    const { done, opened } = run({
      openUrl: async () => {},
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    // Then setup stops with a clear message and changes nothing
    await expect(done).rejects.toThrow(/expired/i);
    expect(opened).toEqual([]);
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(
      '{"keep":"me"}',
    );
  });

  it("still waits and shows the link when no browser can be opened", async () => {
    // Given a Mac with no desktop, where opening fails
    const printed: string[] = [];
    const { done } = run({
      print: (line) => printed.push(line),
      openUrl: async (url) => {
        // The owner opens it elsewhere
        await ownerClicks(url);
        throw new Error("no display");
      },
    });

    // Then setup still finishes once approved
    await done;
    expect(existsSync(join(fake.home, ".claude-office", "config.json"))).toBe(
      true,
    );
    expect(printed.join("\n")).toMatch(/open the link/i);
  });
});
