import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanName, TaskNamer } from "./task-namer";

const KEY = "sk-test-never-logged";

describe("the task namer", () => {
  let home = "";
  let server: Server | undefined;
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    server?.closeAllConnections();
    server?.close();
  });

  /** A namer against a local server answering with `status` and `text`. */
  async function namer(status: number, text: string, logs: string[]) {
    home = mkdtempSync(join(tmpdir(), "office-namer-"));
    server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ content: [{ type: "text", text }] }));
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return new TaskNamer({
      home,
      apiKey: KEY,
      baseUrl: `http://127.0.0.1:${port}`,
      retryMs: 5,
      log: (line) => logs.push(line),
    });
  }

  it("cleans a reply to one line without quotes, and rejects an empty one or one longer than 60 characters instead of cutting it", () => {
    expect(cleanName('"Fix the\n  login" bug')).toBe("Fix the login bug");
    expect(cleanName(" “” ")).toBe("");
    // 60 characters, counted in code points, still fit the desk; one more is a sentence, not a title
    expect(cleanName("😀".repeat(60))).toBe("😀".repeat(60));
    expect(cleanName("😀".repeat(61))).toBe("");
    expect(
      cleanName(
        "I can't tell what the coding session is about from the browser instructions",
      ),
    ).toBe("");
  });

  it("stores a reply too long for the desk as a final failure, not as a cut name", async () => {
    // Given a server that answers with a sentence
    const sentence = await namer(
      200,
      "The user's first message is only a browser automation instruction",
      [],
    );

    // When it asks for a session
    await sentence.ask("long", "<browser_instruction># Claude in Chrome");

    // Then the session has no name and is saved as a final failure
    const saved = JSON.parse(
      readFileSync(join(home, ".claude-office", "task-names.json"), "utf8"),
    );
    expect(saved).toEqual({ long: null });
    expect(sentence.nameOf("long")).toBeUndefined();
  });

  it("drops punctuation at the end of a title but keeps it inside", () => {
    expect(cleanName("Fix the login bug.")).toBe("Fix the login bug");
    expect(cleanName("Fix (login)")).toBe("Fix (login)");
    expect(cleanName("Sửa lỗi đăng nhập!?…")).toBe("Sửa lỗi đăng nhập");
    expect(cleanName("Fix v2.0 login: part 1")).toBe("Fix v2.0 login: part 1");
  });

  it("keeps apostrophes inside a name and strips only the quotes around it", () => {
    expect(cleanName("Fix users' login bug")).toBe("Fix users' login bug");
    expect(cleanName("Don't drop the cart")).toBe("Don't drop the cart");
    expect(cleanName("'Fix login'")).toBe("Fix login");
    expect(cleanName("`“Fix login”`")).toBe("Fix login");
  });

  it("tells the model to reply NONE when the message does not say what the task is, and stores that reply as a final failure, in any case", async () => {
    // Given a server that answers NONE in a few spellings and records the system prompt it receives
    home = mkdtempSync(join(tmpdir(), "office-namer-"));
    const systems: string[] = [];
    let reply = "";
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        systems.push(JSON.parse(body).system);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ content: [{ type: "text", text: reply }] }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const asker = new TaskNamer({
      home,
      apiKey: KEY,
      baseUrl: `http://127.0.0.1:${port}`,
      retryMs: 5,
      log: () => {},
    });

    // When it asks for sessions whose message names no task
    for (const [sessionId, text] of [
      ["upper", "NONE"],
      ["lower", "none"],
      ["quoted", '"None."'],
    ]) {
      reply = text;
      await asker.ask(sessionId, "<browser_instruction># Claude in Chrome");
    }

    // Then the prompt asks for NONE, and each session is a final failure with no name, saved as null
    expect(systems).toHaveLength(3);
    expect(systems[0]).toContain("NONE");
    const saved = JSON.parse(
      readFileSync(join(home, ".claude-office", "task-names.json"), "utf8"),
    );
    expect(saved).toEqual({ upper: null, lower: null, quoted: null });
    expect(asker.nameOf("upper")).toBeUndefined();
    expect(asker.hasAnswer("quoted")).toBe(true);
  });

  it("forgets cached names that were cut short so those sessions are asked again, and keeps whole names and final failures", async () => {
    // Given a cache holding a cut sentence, a whole name and a final failure
    home = mkdtempSync(join(tmpdir(), "office-namer-"));
    mkdirSync(join(home, ".claude-office"), { recursive: true });
    writeFileSync(
      join(home, ".claude-office", "task-names.json"),
      JSON.stringify({
        cut: "I can't tell what the coding session is about from the brow…",
        whole: "Fix login redirect",
        failed: null,
      }),
    );

    // When a namer loads it
    const loaded = new TaskNamer({
      home,
      apiKey: KEY,
      baseUrl: "http://127.0.0.1:1",
      log: () => {},
    });

    // Then the cut one has no answer, and the others are kept as they were
    expect(loaded.hasAnswer("cut")).toBe(false);
    expect(loaded.nameOf("cut")).toBeUndefined();
    expect(loaded.nameOf("whole")).toBe("Fix login redirect");
    expect(loaded.hasAnswer("failed")).toBe(true);
    expect(loaded.nameOf("failed")).toBeUndefined();
  });

  it("asks once for a session whose key was refused or whose paste got a final failure, however often it is asked again", async () => {
    // Given a server that answers 401 for one session and 400 for another, counting what it receives
    home = mkdtempSync(join(tmpdir(), "office-namer-"));
    const statusOf: Record<string, number> = { keyless: 401, badpaste: 400 };
    let requests = 0;
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests++;
        const id = body.includes("id-keyless") ? "keyless" : "badpaste";
        response.writeHead(statusOf[id], {
          "content-type": "application/json",
        });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const namerUnderTest = new TaskNamer({
      home,
      apiKey: KEY,
      baseUrl: `http://127.0.0.1:${port}`,
      retryMs: 5,
      log: () => {},
    });

    // When each session is asked three times, one after the other
    for (const id of ["keyless", "badpaste"]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await namerUnderTest.ask(id, `id-${id} text`);
      }
    }

    // Then the server saw one request per session and both count as answered
    expect(requests).toBe(2);
    expect(namerUnderTest.hasAnswer("keyless")).toBe(true);
    expect(namerUnderTest.hasAnswer("badpaste")).toBe(true);
  });

  it("keeps only the newest 500 answers, starts empty from a corrupt cache file, and never logs the key", async () => {
    // Given a corrupt cache file, and a namer that cannot reach its server
    const logs: string[] = [];
    const good = await namer(200, "A name", logs);
    mkdirSync(join(home, ".claude-office"), { recursive: true });
    writeFileSync(
      join(home, ".claude-office", "task-names.json"),
      "{ not json",
    );
    const unreachable = new TaskNamer({
      home,
      apiKey: KEY,
      baseUrl: "http://127.0.0.1:1",
      retryMs: 1,
      log: (l) => logs.push(l),
    });
    expect(unreachable.nameOf("any")).toBeUndefined();
    await unreachable.ask("net", "paste");

    // When 502 sessions are answered
    for (let i = 0; i < 502; i++) await good.ask(`s${i}`, "paste");

    // Then the oldest two were dropped from the saved file, and no log line holds the key
    const saved = JSON.parse(
      readFileSync(join(home, ".claude-office", "task-names.json"), "utf8"),
    );
    expect(Object.keys(saved)).toHaveLength(500);
    expect(saved).not.toHaveProperty("s0");
    expect(saved.s501).toBe("A name");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
  }, 30_000);

  it("saves the cache file private to the owner, and never logs the pasted text", async () => {
    // Given a namer whose server answers 500 for a paste holding a sentinel
    const logs: string[] = [];
    const failing = await namer(500, "", logs);

    // When it asks, retries and gives up, and a good one saves a name
    await failing.ask("bad", "SENTINEL-PASTE-HEAD");
    const good = await namer(200, "A name", logs);
    await good.ask("ok", "SENTINEL-PASTE-HEAD");

    // Then the file is 0600, the failure is remembered, and no log line holds the paste
    const file = join(home, ".claude-office", "task-names.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain("SENTINEL-PASTE-HEAD");
    expect(good.hasAnswer("ok")).toBe(true);
    expect(failing.hasAnswer("bad")).toBe(true);
  });

  it("makes no further request and writes no log when stopped during a request or during the retry pause", async () => {
    // Given a server that never answers, and a second one that fails so the namer waits to retry
    const logs: string[] = [];
    home = mkdtempSync(join(tmpdir(), "office-namer-"));
    let hits = 0;
    let status = 0;
    server = createServer((_request, response) => {
      hits++;
      if (!status) return;
      response.writeHead(status, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const make = (retryMs: number) =>
      new TaskNamer({
        home,
        apiKey: KEY,
        baseUrl,
        retryMs,
        log: (line) => logs.push(line),
      });

    // When it is stopped while the request is running
    const running = make(5);
    const first = running.ask("a", "paste");
    await expect.poll(() => hits).toBe(1);
    running.stop();
    await first;

    // And stopped during the retry pause
    status = 500;
    const pausing = make(60_000);
    const second = pausing.ask("b", "paste");
    await expect.poll(() => hits).toBe(2);
    await expect.poll(() => logs.length).toBe(1);
    pausing.stop();
    await second;

    // Then nothing more was requested, and the only log line is the HTTP 500 before the pause
    expect(hits).toBe(2);
    expect(logs).toEqual(["task namer: HTTP 500"]);
    expect(running.hasAnswer("a")).toBe(false);
    expect(pausing.hasAnswer("b")).toBe(false);
  });
});
