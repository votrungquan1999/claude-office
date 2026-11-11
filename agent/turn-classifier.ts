import { createHash } from "node:crypto";
import { z } from "zod";

const MODEL = "claude-haiku-5-5";
const DEFAULT_TIMEOUT_MS = 10_000;
const TEXT_MAX = 1000;
const MAX_CACHED = 500;
const SYSTEM_PROMPT =
  "You read the last part of an AI coding assistant's final message. Decide whether it asks the user to answer a question, choose between options, approve something or provide something before the work can go on. Reply with one word: YES or NO.";

/** The parts of a Messages API answer the classifier reads. */
const messageSchema = z.object({
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface TurnClassifierOptions {
  apiKey: string;
  /** The API's address without a trailing slash. */
  baseUrl: string;
  /** Longest wait for one answer. */
  timeoutMs?: number;
  /** The HTTP client; the global `fetch` when absent. */
  fetchFn?: typeof fetch;
  log: (message: string) => void;
}

/**
 * Asks Haiku whether a finished answer asks the owner to reply, and remembers each answer in memory.
 */
export class TurnClassifier {
  /** Verdicts by session and message hash, oldest first; only YES and NO are kept. */
  private readonly cache = new Map<string, boolean>();
  private readonly running = new Map<string, Promise<boolean | undefined>>();
  private readonly abort = new AbortController();

  constructor(private readonly options: TurnClassifierOptions) {}

  /**
   * Whether the answer asks the owner to answer, choose, approve or provide something.
   * @param sessionId - The session the answer belongs to.
   * @param text - The answer; only its last 1,000 characters are sent.
   * @returns True or false, or undefined when no answer could be had.
   */
  asksOwner(sessionId: string, text: string): Promise<boolean | undefined> {
    const tail = Array.from(text).slice(-TEXT_MAX).join("");
    const key = `${sessionId}:${createHash("sha256").update(tail).digest("hex")}`;
    const known = this.cache.get(key);
    if (known !== undefined) return Promise.resolve(known);
    const existing = this.running.get(key);
    if (existing) return existing;
    const call = this.request(tail)
      .then((verdict) => {
        if (verdict !== undefined) this.remember(key, verdict);
        return verdict;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, call);
    return call;
  }

  /** Aborts every running request. */
  stop(): void {
    this.abort.abort();
  }

  /** One call to the Messages API; never logs the key, the headers or the text. */
  private async request(tail: string): Promise<boolean | undefined> {
    if (this.abort.signal.aborted) return undefined;
    const send = this.options.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await send(`${this.options.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8,
          system: SYSTEM_PROMPT,
          // Haiku 5.5 thinks by default, and thinking would eat the small token budget.
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: tail }],
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          this.abort.signal,
        ]),
      });
    } catch {
      // Error boundary: a failed call only means the plain rule decides.
      if (!this.abort.signal.aborted) {
        this.options.log("turn classifier: request failed");
      }
      return undefined;
    }
    if (!response.ok) {
      this.options.log(`turn classifier: HTTP ${response.status}`);
      return undefined;
    }
    const parsed = messageSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success || parsed.data.stop_reason === "refusal") {
      return undefined;
    }
    const word = parsed.data.content
      .find((block) => block.type === "text")
      ?.text?.trim()
      .toUpperCase();
    if (word?.startsWith("YES")) return true;
    if (word?.startsWith("NO")) return false;
    return undefined;
  }

  /** Stores a verdict and keeps only the newest entries. */
  private remember(key: string, verdict: boolean): void {
    this.cache.delete(key);
    this.cache.set(key, verdict);
    while (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
