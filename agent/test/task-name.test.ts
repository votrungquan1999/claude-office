import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { runHook } from "./run-hook";

const KEY = "sk-test-fake-key";
const PASTE = `<pasted_content id="d1">Stack trace: TypeError in checkout cart total ${"x".repeat(900)}</pasted_content id="d1">`;

/** A Messages API answer whose first text block is `text`. */
function answer(text: string) {
  return {
    status: 200,
    body: {
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    },
  };
}

describe("a session is named by Haiku", () => {
  const { setUpMac, officeSessions, startFakeAnthropic } = useMacHarness();
  const processes = useLiveProcesses();

  /** Sends one prompt through the real hook. */
  function prompt(home: string, sessionId: string, text: string) {
    return runHook(home, {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: `/work/${sessionId}`,
      prompt: text,
    });
  }

  it("asks once with the paste head, shows the returned name, and does not ask again for a second prompt", async () => {
    // Given a fake Anthropic server and an agent holding a key
    const anthropic = await startFakeAnthropic(() =>
      answer("Checkout cart total bug"),
    );
    const { fake, agent } = await setUpMac(
      "machine-air",
      "Quan's MacBook Air",
      {
        anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
      },
    );
    fake.addSession({ sessionId: "s1", cwd: "/work/s1", name: "" });

    // When the owner sends a paste-only prompt, then another prompt
    await prompt(fake.home, "s1", PASTE);
    await agent.flush();
    await prompt(fake.home, "s1", "and then something else");
    await agent.flush();

    // Then exactly one well-formed request was made and the desk shows its answer
    expect(anthropic.requests).toHaveLength(1);
    const [request] = anthropic.requests;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1/messages");
    expect(request.headers["x-api-key"]).toBe(KEY);
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.body.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(request.body.messages)).toContain(
      "Stack trace: TypeError in checkout",
    );
    expect(request.body.thinking).toEqual({ type: "disabled" });
    expect(request.body.output_config).toEqual({ effort: "low" });
    for (const banned of ["temperature", "top_p", "top_k"]) {
      expect(request.body).not.toHaveProperty(banned);
    }
    expect(request.body.messages).toHaveLength(1);
    expect((await officeSessions())[0]?.deskName).toBe(
      "Checkout cart total bug",
    );
  });

  it("names a typed session from the first 1,000 characters of its first message, once, and keeps the 60-character first message when there is no key", async () => {
    // Given a keyed agent, a keyless one, and a first message longer than 1,000 characters
    const anthropic = await startFakeAnthropic(() =>
      answer("Check VN30 conversation"),
    );
    const message = `check the latest messesage on the real vn30 conversatino ${"y".repeat(1200)}`;
    const keyed = await setUpMac("machine-a", "Mac A", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    keyed.fake.addSession({ sessionId: "k1", cwd: "/work/k1", name: "" });
    const keyless = await setUpMac("machine-b", "Mac B", {
      anthropic: { baseUrl: anthropic.baseUrl },
    });
    keyless.fake.addSession({ sessionId: "n1", cwd: "/work/n1", name: "" });

    // When each Mac's session gets the message, and the keyed one a second prompt
    await prompt(keyed.fake.home, "k1", message);
    await prompt(keyless.fake.home, "n1", message);
    await keyed.agent.flush();
    await keyless.agent.flush();
    await prompt(keyed.fake.home, "k1", "and something else");
    await keyed.agent.flush();

    // Then one request carried the head of the message, and only the keyed desk got Haiku's name
    expect(anthropic.requests).toHaveLength(1);
    const sent = JSON.stringify(anthropic.requests[0].body.messages);
    expect(sent).toContain("check the latest messesage");
    expect(sent).not.toContain("y".repeat(1000));
    const names = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
    );
    expect(names.k1).toBe("Check VN30 conversation");
    expect(names.n1).toBe(
      "check the latest messesage on the real vn30 conversatino yy…",
    );
  });

  it("keeps the name an earlier version cached for a session without asking again", async () => {
    // Given a cache file from the paste-only namer and a keyed agent
    const anthropic = await startFakeAnthropic(() => answer("Never used"));
    const live = await processes.live();
    const { fake, agent } = await setUpMac("machine-air", "Mac", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
      beforeStart(home) {
        mkdirSync(join(home.home, ".claude-office"), { recursive: true });
        writeFileSync(
          join(home.home, ".claude-office", "pasted-names.json"),
          JSON.stringify({ old: "Cart total crash" }),
        );
        home.addSession({
          sessionId: "old",
          cwd: "/work/old",
          name: "",
          pid: live.pid,
          procStart: live.procStart,
        });
        home.addTranscript("old", [
          {
            type: "user",
            cwd: "/work/old",
            isSidechain: false,
            message: { role: "user", content: PASTE },
          },
        ]);
      },
    });

    // When the agent has started and the session sends another prompt
    await prompt(fake.home, "old", "more");
    await agent.flush();

    // Then the old name shows and Anthropic was never asked
    expect(anthropic.requests).toHaveLength(0);
    expect((await officeSessions())[0]?.deskName).toBe("Cart total crash");
  });

  it("stores the typed first message as the request with its line breaks, up to 2,000 characters, and none for a paste-only message or a command", async () => {
    // Given a keyless agent with four sessions
    const { fake, agent } = await setUpMac("machine-air", "Mac");
    for (const id of ["typed", "long", "paste", "slash"]) {
      fake.addSession({ sessionId: id, cwd: `/work/${id}`, name: "" });
    }

    // When each sends a first prompt (the hook has already stripped the paste body)
    await prompt(fake.home, "typed", "Fix the cart\n\n\n\nthen   deploy it");
    await prompt(fake.home, "long", `${"w".repeat(1999)}AB`);
    await prompt(fake.home, "paste", PASTE);
    await prompt(fake.home, "slash", "/clear");
    await agent.flush();

    // Then the typed ones keep their request, and the others have none
    const requests = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.request]),
    );
    expect(requests.typed).toBe("Fix the cart\n\nthen deploy it");
    expect(requests.long).toBe(`${"w".repeat(1999)}A`);
    expect(requests.paste).toBeUndefined();
    expect(requests.slash).toBeUndefined();
  });

  it("names a typed session that was already running when the agent started, once, and keeps its request", async () => {
    // Given a running session whose transcript holds a typed first message
    const live = await processes.live();
    const anthropic = await startFakeAnthropic(() => answer("Cart total fix"));
    const options = {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    };
    const first = await setUpMac("machine-air", "Mac", {
      ...options,
      beforeStart(home) {
        home.addSession({
          sessionId: "run",
          cwd: "/work/run",
          name: "",
          pid: live.pid,
          procStart: live.procStart,
        });
        home.addTranscript("run", [
          {
            type: "user",
            cwd: "/work/run",
            isSidechain: false,
            message: { role: "user", content: "fix the cart total" },
          },
        ]);
      },
    });
    await first.agent.flush();

    // When the agent restarts
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Mac", {
      ...options,
      fake: first.fake,
    });
    await second.agent.flush();

    // Then one call named it and the restart reused the cache
    expect(anthropic.requests).toHaveLength(1);
    const [row] = await officeSessions();
    expect(row.deskName).toBe("Cart total fix");
    expect(row.request).toBe("fix the cart total");
  });

  it("makes no call without a key, for a held session, or while a card names the desk", async () => {
    // Given a fake server, one agent with no key, and one with a key
    const anthropic = await startFakeAnthropic(() => answer("Never used"));
    const keyless = await setUpMac("machine-a", "Mac A", {
      anthropic: { baseUrl: anthropic.baseUrl },
    });
    keyless.fake.addSession({
      sessionId: "nokey",
      cwd: "/work/nokey",
      name: "",
    });
    await prompt(keyless.fake.home, "nokey", PASTE);
    await keyless.agent.flush();
    expect((await officeSessions())[0]?.deskName).toBe("Pasted text");
    await keyless.agent.stop();

    const keyed = await setUpMac("machine-b", "Mac B", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    const { fake, agent } = keyed;
    fake.addSession({ sessionId: "carded", cwd: "/work/carded", name: "" });

    // When a session with no registry entry sends a prompt, and a card names a desk
    await prompt(fake.home, "held", PASTE);
    fake.writeKanban("carded", { cardId: "c1", summary: "Card name" });
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "carded",
      cwd: "/work/carded",
    });
    await expect
      .poll(
        async () => {
          await agent.flush();
          return (await officeSessions()).find((s) => s.sessionId === "carded")
            ?.deskName;
        },
        { timeout: 5000 },
      )
      .toBe("Card name");
    await prompt(fake.home, "carded", PASTE);
    await agent.flush();

    // Then no request was made and the card still names its desk
    expect(
      anthropic.requests.map((r) =>
        JSON.stringify(r.body.messages).slice(0, 80),
      ),
    ).toEqual([]);
    const names = Object.fromEntries(
      (await officeSessions())
        .filter((s) => s.machineId === "machine-b")
        .map((s) => [s.sessionId, s.deskName]),
    );
    expect(names).toEqual({ carded: "Card name" });
  });

  it("retries once after the pause on a server error, then falls back to Pasted text", async () => {
    // Given a fake server that always answers 500
    const anthropic = await startFakeAnthropic(() => ({
      status: 500,
      body: {},
    }));
    const { fake, agent } = await setUpMac("machine-air", "Mac", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY, retryMs: 50 },
    });
    fake.addSession({ sessionId: "s1", cwd: "/work/s1", name: "" });

    // When a paste-only prompt arrives and the session keeps publishing
    await prompt(fake.home, "s1", PASTE);
    await agent.flush();
    await prompt(fake.home, "s1", "more");
    await agent.flush();

    // Then there were exactly two requests and the desk shows the placeholder
    expect(anthropic.requests).toHaveLength(2);
    expect((await officeSessions())[0]?.deskName).toBe("Pasted text");
  });

  it("recovers when the retry succeeds, and does not retry a 400, a refusal or an empty answer", async () => {
    // Given a server that fails once with 429, and sessions answered 400, refusal, empty
    const replies: Record<string, () => { status: number; body: unknown }> = {
      flaky: () => answer("Cart total bug"),
      bad: () => ({ status: 400, body: {} }),
      refused: () => ({
        status: 200,
        body: { stop_reason: "refusal", content: [] },
      }),
      empty: () => answer('  ""  '),
    };
    let flakyCalls = 0;
    const anthropic = await startFakeAnthropic((request) => {
      const content = JSON.stringify(request.body.messages);
      const id =
        ["flaky", "bad", "refused", "empty"].find((word) =>
          content.includes(`id-${word}`),
        ) ?? "";
      if (id === "flaky" && flakyCalls++ === 0)
        return { status: 429, body: {} };
      return replies[id]();
    });
    const { fake, agent } = await setUpMac("machine-air", "Mac", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY, retryMs: 50 },
    });

    // When each session sends a paste-only prompt
    for (const id of Object.keys(replies)) {
      fake.addSession({ sessionId: id, cwd: `/work/${id}`, name: "" });
      await prompt(
        fake.home,
        id,
        `<pasted_content id="p">id-${id} text</pasted_content id="p">`,
      );
    }
    await agent.flush();

    // Then the retry recovered, the others made one request each, and fell back to the placeholder
    const names = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
    );
    expect(names).toEqual({
      flaky: "Cart total bug",
      bad: "Pasted text",
      refused: "Pasted text",
      empty: "Pasted text",
    });
    expect(anthropic.requests).toHaveLength(5);
  });

  it("names a session after a restart with a corrected key when the first key was refused with 401 or 403", async () => {
    // Given running paste-only sessions and a server that refuses the first key of each with 401 and 403
    const live = [await processes.live(), await processes.live()];
    const refusals = [401, 403];
    const anthropic = await startFakeAnthropic((_request, count) =>
      count <= refusals.length
        ? { status: refusals[count - 1], body: {} }
        : answer("Checkout total crash"),
    );
    const first = await setUpMac("machine-air", "Mac", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: "sk-test-mistyped" },
      beforeStart(home) {
        for (const [index, id] of ["a", "b"].entries()) {
          home.addSession({
            sessionId: id,
            cwd: `/work/${id}`,
            name: "",
            pid: live[index].pid,
            procStart: live[index].procStart,
          });
          home.addTranscript(id, [
            {
              type: "user",
              cwd: `/work/${id}`,
              isSidechain: false,
              message: { role: "user", content: PASTE },
            },
          ]);
        }
      },
    });
    await first.agent.flush();
    expect(anthropic.requests).toHaveLength(2);

    // When the agent restarts with a good key
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Mac", {
      fake: first.fake,
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    await second.agent.flush();

    // Then each session was asked again once and is named
    expect(anthropic.requests).toHaveLength(4);
    expect((await officeSessions()).map((s) => s.deskName)).toEqual([
      "Checkout total crash",
      "Checkout total crash",
    ]);
  });

  it("keeps the answer across an agent restart without asking again, beats /rename, and asks for a running paste-only session once a key is added", async () => {
    // Given running sessions whose transcripts hold a paste, one renamed; the agent has no key yet
    const live = [await processes.live(), await processes.live()];
    const user = (text: string) => ({
      type: "user",
      cwd: "/work/a",
      isSidechain: false,
      message: { role: "user", content: text },
    });
    const anthropic = await startFakeAnthropic(() =>
      answer("Checkout total crash"),
    );
    const first = await setUpMac("machine-air", "Mac", {
      beforeStart(home) {
        home.addSession({
          sessionId: "plain",
          cwd: "/work/a",
          name: "",
          pid: live[0].pid,
          procStart: live[0].procStart,
        });
        home.addSession({
          sessionId: "renamed",
          cwd: "/work/b",
          name: "My own name",
          pid: live[1].pid,
          procStart: live[1].procStart,
        });
        for (const id of ["plain", "renamed"])
          home.addTranscript(id, [user(PASTE)]);
      },
    });
    expect(anthropic.requests).toHaveLength(0);
    expect((await officeSessions()).map((s) => s.deskName).sort()).toEqual([
      "My own name",
      "Pasted text",
    ]);

    // When the agent restarts with a key (R57), then restarts again
    await first.agent.stop();
    const second = await setUpMac("machine-air", "Mac", {
      fake: first.fake,
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    await second.agent.flush();
    const afterKey = (await officeSessions()).map((s) => s.deskName);
    await second.agent.stop();
    const third = await setUpMac("machine-air", "Mac", {
      fake: first.fake,
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    await third.agent.flush();

    // Then each session was asked once, Haiku's name beat the placeholder and /rename, and the restart reused the cache
    expect(afterKey).toEqual(["Checkout total crash", "Checkout total crash"]);
    expect(anthropic.requests).toHaveLength(2);
    expect((await officeSessions()).map((s) => s.deskName)).toEqual([
      "Checkout total crash",
      "Checkout total crash",
    ]);
  });

  it("makes no request for a desk that went home, and a keyed run stores and logs no pasted text", async () => {
    // Given a keyed agent, and a paste holding a sentinel
    const anthropic = await startFakeAnthropic(() => answer("Cart bug name"));
    const logs: string[] = [];
    const { fake, agent } = await setUpMac("machine-air", "Mac", {
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
      log: (line) => logs.push(line),
    });
    const sentinel = `<pasted_content id="d1">KEYEDSECRETBODY ${"x".repeat(600)}</pasted_content id="d1">`;
    fake.addSession({ sessionId: "home", cwd: "/work/home", name: "" });
    fake.addSession({ sessionId: "named", cwd: "/work/named", name: "" });

    // When one paste-only session ends before the agent publishes it, and another stays
    await prompt(fake.home, "home", sentinel);
    await runHook(fake.home, {
      hook_event_name: "SessionEnd",
      session_id: "home",
      cwd: "/work/home",
      reason: "other",
    });
    await prompt(fake.home, "named", sentinel);
    await agent.flush();

    // Then only the staying session was asked, and the paste is in no stored document or log line
    expect(anthropic.requests).toHaveLength(1);
    const db = await getDb();
    const dump: string[] = [];
    for (const { name } of await db.listCollections().toArray()) {
      dump.push(JSON.stringify(await db.collection(name).find({}).toArray()));
    }
    expect(dump.join("\n")).not.toContain("KEYEDSECRETBODY");
    expect(logs.join("\n")).not.toContain("KEYEDSECRETBODY");
  }, 30_000);

  it("opens the hook listener on a restart while Anthropic still holds the reply for a running paste-only session", async () => {
    // Given a running paste-only session and a fake Anthropic that holds its reply
    const live = await processes.live();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anthropic = await startFakeAnthropic(async () => {
      await held;
      return answer("Checkout total crash");
    });
    const first = await setUpMac("machine-air", "Mac", {
      beforeStart(home) {
        home.addSession({
          sessionId: "pasted",
          cwd: "/work/a",
          name: "",
          pid: live.pid,
          procStart: live.procStart,
        });
        home.addTranscript("pasted", [
          {
            type: "user",
            cwd: "/work/a",
            isSidechain: false,
            message: { role: "user", content: PASTE },
          },
        ]);
      },
    });
    await first.agent.stop();

    // When the agent restarts with a key and the request to Anthropic hangs
    const starting = setUpMac("machine-air", "Mac", {
      fake: first.fake,
      anthropic: { baseUrl: anthropic.baseUrl, apiKey: KEY },
    });
    try {
      await expect
        .poll(() => anthropic.requests.length, { timeout: 5000 })
        .toBe(1);

      // Then the agent is already listening and a hook event for another session lands
      const outcome = await Promise.race([
        starting.then(() => "listening"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 3000)),
      ]);
      expect(outcome).toBe("listening");
      const { fake, agent } = await starting;
      fake.addSession({ sessionId: "other", cwd: "/work/other", name: "" });
      await prompt(fake.home, "other", "fix the cart");
      release();
      await agent.flush();
      const names = Object.fromEntries(
        (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
      );
      expect(names).toEqual({
        pasted: "Checkout total crash",
        other: "Checkout total crash",
      });
    } finally {
      release();
      await starting.catch(() => undefined);
    }
  }, 30_000);
});
