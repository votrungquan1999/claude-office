import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cutName, NAME_INPUT_MAX } from "../src/shared/desk-name";
import { officeDir, writeFileAtomic } from "./config";

const MODEL = "claude-haiku-5-5";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_MS = 30_000;
const MAX_CACHED = 500;
const SYSTEM_PROMPT =
  "Write a short task title for a coding session from the first message the user opened it with: at most 6 words, a title and not a sentence, in the language of the message, plain text, no quotes, no punctuation at the end. Reply with the title only.";

/** Answers and final failures (null) kept per session id, oldest first. */
const cacheSchema = z.record(z.string(), z.string().nullable());

/** The parts of a Messages API answer the namer reads. */
const messageSchema = z.object({
  stop_reason: z.string().nullish(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export interface TaskNamerOptions {
  home: string;
  apiKey: string;
  /** The API's address without a trailing slash. */
  baseUrl: string;
  /** Wait before the single retry of a transient failure. */
  retryMs?: number;
  log: (message: string) => void;
}

/** How a request ended: a name, a final failure, a refused key, or a failure worth one retry. */
type Outcome =
  | { kind: "name"; name: string }
  | { kind: "final" }
  | { kind: "refused" }
  | { kind: "retry" };

/**
 * Asks Haiku for a short task name of a session from its first message, once per session, and remembers the answer on this Mac.
 */
export class TaskNamer {
  private readonly cacheFile: string;
  /** The file paste-only names were kept in before every session was named; read, never written. */
  private readonly legacyCacheFile: string;
  private readonly cache = new Map<string, string | null>();
  private readonly inFlight = new Set<string>();
  /** Sessions whose key was refused this run; never stored, so a corrected key asks again after a restart. */
  private readonly refused = new Set<string>();
  private readonly abort = new AbortController();
  private readonly retryMs: number;

  constructor(private readonly options: TaskNamerOptions) {
    this.cacheFile = join(officeDir(options.home), "task-names.json");
    this.legacyCacheFile = join(officeDir(options.home), "pasted-names.json");
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.loadCache();
  }

  /**
   * The name already known for a session.
   * @param sessionId - The session.
   * @returns The cached name, or undefined while none is known or the last try failed for good.
   */
  nameOf(sessionId: string): string | undefined {
    return this.cache.get(sessionId) ?? undefined;
  }

  /**
   * Tells whether a session has an answer or a final failure on record.
   * @param sessionId - The session.
   * @returns True once a name or a permanent failure is cached.
   */
  hasAnswer(sessionId: string): boolean {
    return this.cache.has(sessionId) || this.refused.has(sessionId);
  }

  /**
   * Starts the one request for a session unless it was answered, failed for good, or is already running.
   * @param sessionId - The session.
   * @param requestHead - The first message; only its first 1,000 characters are sent.
   * @returns The running request, or undefined when nothing was started.
   */
  ask(sessionId: string, requestHead: string): Promise<void> | undefined {
    if (this.hasAnswer(sessionId) || this.inFlight.has(sessionId)) {
      return undefined;
    }
    this.inFlight.add(sessionId);
    return this.run(sessionId, requestHead)
      .catch(() => this.options.log("task namer: could not save the name"))
      .finally(() => this.inFlight.delete(sessionId));
  }

  /** Aborts every running request and pending retry. */
  stop(): void {
    this.abort.abort();
  }

  /** Runs the request, with one retry after a pause when the failure is transient. */
  private async run(sessionId: string, requestHead: string): Promise<void> {
    if (this.abort.signal.aborted) return;
    let outcome = await this.request(requestHead);
    if (outcome.kind === "retry") {
      await new Promise<void>((resolve) => {
        const { signal } = this.abort;
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, this.retryMs);
        timer.unref();
        signal.addEventListener("abort", onAbort, { once: true });
      });
      if (this.abort.signal.aborted) return;
      outcome = await this.request(requestHead);
    }
    if (this.abort.signal.aborted) return;
    if (outcome.kind === "refused") {
      this.refused.add(sessionId);
      return;
    }
    this.remember(sessionId, outcome.kind === "name" ? outcome.name : null);
  }

  /** One call to the Messages API; never logs the key, the headers or the request text. */
  private async request(requestHead: string): Promise<Outcome> {
    if (this.abort.signal.aborted) return { kind: "final" };
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 64,
          system: SYSTEM_PROMPT,
          // Haiku 5.5 thinks by default, and thinking would eat the small token budget.
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: Array.from(requestHead)
                .slice(0, NAME_INPUT_MAX)
                .join(""),
            },
          ],
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          this.abort.signal,
        ]),
      });
    } catch {
      if (this.abort.signal.aborted) return { kind: "final" };
      this.options.log("task namer: request failed (network)");
      return { kind: "retry" };
    }
    if (!response.ok) {
      this.options.log(`task namer: HTTP ${response.status}`);
      // A bad key says nothing about the paste, so it is not a final failure.
      if (response.status === 401 || response.status === 403) {
        return { kind: "refused" };
      }
      return response.status >= 500 || response.status === 429
        ? { kind: "retry" }
        : { kind: "final" };
    }
    const parsed = messageSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success || parsed.data.stop_reason === "refusal") {
      return { kind: "final" };
    }
    const text = parsed.data.content.find(
      (block) => block.type === "text",
    )?.text;
    const name = cleanName(text ?? "");
    return name ? { kind: "name", name } : { kind: "final" };
  }

  /** Stores an answer or a final failure and keeps only the newest entries. */
  private remember(sessionId: string, name: string | null): void {
    this.cache.delete(sessionId);
    this.cache.set(sessionId, name);
    while (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    mkdirSync(officeDir(this.options.home), { recursive: true, mode: 0o700 });
    writeFileAtomic(
      this.cacheFile,
      JSON.stringify(Object.fromEntries(this.cache)),
      0o600,
    );
  }

  /** Reads the old cache file, then the current one; a missing or corrupt file counts as empty. */
  private loadCache(): void {
    for (const file of [this.legacyCacheFile, this.cacheFile]) {
      try {
        const parsed = cacheSchema.parse(
          JSON.parse(readFileSync(file, "utf8")),
        );
        for (const [sessionId, name] of Object.entries(parsed)) {
          this.cache.set(sessionId, name);
        }
      } catch {
        // Error boundary: a bad cache only costs a repeat call.
      }
    }
  }
}

/**
 * Turns the model's reply into a desk name.
 * @param text - The reply text.
 * @returns One line without quotes, cut to the desk length; empty when nothing usable is left.
 */
export function cleanName(text: string): string {
  const oneLine = text
    .replace(/["`“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // A single quote only wraps a name at its ends; inside it is an apostrophe.
    .replace(/^['‘’\s]+|['‘’\s]+$/g, "")
    // A title has no sentence punctuation at its end.
    .replace(/[.,;:!?…。！？\s]+$/u, "");

  return oneLine ? cutName(oneLine) : "";
}
