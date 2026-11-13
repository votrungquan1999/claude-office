import { describe, expect, it } from "vitest";
import { TurnClassifier } from "./turn-classifier";

/** A Messages API answer whose first text block is `text`. */
function reply(text: string): Response {
  return new Response(
    JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    }),
    { status: 200 },
  );
}

function classifier(fetchFn: typeof fetch, timeoutMs?: number) {
  return new TurnClassifier({
    apiKey: "sk-test-fake-key",
    baseUrl: "http://fake.invalid",
    timeoutMs,
    fetchFn,
    log: () => {},
  });
}

describe("the turn classifier", () => {
  it("reads ASKS as asking and sends only the last 1,000 characters", async () => {
    // Given a model that answers ASKS
    const bodies: Array<{ messages: Array<{ content: string }> }> = [];
    const fake = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return reply("ASKS");
    }) as typeof fetch;

    // When a long answer is classified
    const text = `${"a".repeat(1500)}Reply "A" or "B".`;
    const result = await classifier(fake).classify("s1", text);

    // Then it asks, and the request holds the answer's tail
    expect(result).toBe("asks");
    expect(bodies[0].messages[0].content).toBe(text.slice(-1000));
  });

  it("reads REPORTS as a result and NOTHING as nothing to show", async () => {
    const answerOf = (word: string) =>
      classifier((async () => reply(word)) as typeof fetch).classify(
        "s1",
        "Done, all tests pass.",
      );
    expect(await answerOf("REPORTS")).toBe("reports");
    expect(await answerOf("NOTHING")).toBe("nothing");
  });

  it("gives no verdict when the call times out, fails, or answers something else", async () => {
    // Given a call that never answers within the timeout
    const hang = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("t")));
      })) as typeof fetch;
    const failing = (async () =>
      new Response("{}", { status: 500 })) as typeof fetch;
    const odd = (async () => reply("MAYBE")) as typeof fetch;
    const oldFormat = (async () => reply("YES")) as typeof fetch;

    // Then each yields no verdict
    expect(await classifier(hang, 20).classify("s1", "x")).toBeUndefined();
    expect(await classifier(failing).classify("s1", "x")).toBeUndefined();
    expect(await classifier(odd).classify("s1", "x")).toBeUndefined();
    expect(await classifier(oldFormat).classify("s1", "x")).toBeUndefined();
  });

  it("asks once for the same session and message, and again for a new message", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return reply("ASKS");
    }) as typeof fetch;
    const c = classifier(counting);

    await c.classify("s1", "Pick A or B?");
    await c.classify("s1", "Pick A or B?");
    expect(calls).toBe(1);

    await c.classify("s1", "Pick C or D?");
    await c.classify("s2", "Pick A or B?");
    expect(calls).toBe(3);
  });
});
