import { useEffect, useRef, useState } from "react";
import { type ChangesResponse, changesResponseSchema } from "@/shared/session";

const MAX_BACKOFF_MS = 30_000;
/** A poll that has not answered by then counts as failed, so a stalled connection cannot freeze the chain. */
const POLL_TIMEOUT_MS = 10_000;

/** The server no longer knows the owner's session. */
class SessionExpiredError extends Error {}

export interface UseOfficeChangesOptions {
  /** Polling starts once the office can show sessions. */
  enabled: boolean;
  /** Pause between the end of one poll and the start of the next. */
  intervalMs?: number;
  /** ISO time of the browser's local midnight, sent with the first load. */
  dayStart: string;
  /** Called with every answer; `firstLoad` is true for the one without a cursor, `poll` numbers polls in the order they started. */
  onAnswer: (answer: ChangesResponse, firstLoad: boolean, poll: number) => void;
  /** Called once when the session has expired; polling stops. */
  onUnauthorized: () => void;
}

export interface OfficeChangesStatus {
  /** When the last answer arrived (browser clock, only shown as "N min ago"). */
  lastUpdatedAt: number | null;
  /** The last poll failed. */
  connectionLost: boolean;
}

export interface OfficeChanges extends OfficeChangesStatus {
  /** The number of the last poll started so far; 0 before the first. */
  lastStartedPoll: () => number;
}

/**
 * Keeps the office current by polling the changes API while the tab is visible.
 * @param options - Timing and callbacks.
 * @returns Whether the last poll worked, when it last did, and how many polls have started.
 */
export function useOfficeChanges(
  options: UseOfficeChangesOptions,
): OfficeChanges {
  const { enabled, intervalMs = 3000, dayStart } = options;
  const [status, setStatus] = useState<OfficeChangesStatus>({
    lastUpdatedAt: null,
    connectionLost: false,
  });
  const latest = useRef(options);
  latest.current = options;
  const pollsStarted = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cursor: string | undefined;
    let failures = 0;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async (signal: AbortSignal) => {
      const number = ++pollsStarted.current;
      const query = cursor
        ? `since=${encodeURIComponent(cursor)}`
        : `dayStart=${encodeURIComponent(dayStart)}`;
      const response = await fetch(`/api/office/changes?${query}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]),
      });
      if (response.status === 401) throw new SessionExpiredError();
      if (!response.ok) throw new Error(`changes answered ${response.status}`);
      const body = changesResponseSchema.parse(await response.json());
      latest.current.onAnswer(body, cursor === undefined, number);
      cursor = body.cursor;
    };
    // A chain, not an interval: the next poll starts one interval after the last one ended.
    const run = async () => {
      timer = undefined;
      controller = new AbortController();
      const { signal } = controller;
      let delay = intervalMs;
      try {
        await poll(signal);
        failures = 0;
        setStatus({ lastUpdatedAt: Date.now(), connectionLost: false });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof SessionExpiredError) {
          expired = true;
          latest.current.onUnauthorized();
          return;
        }
        // Network and server errors alike: keep the cursor, say so, and slow down.
        failures += 1;
        delay = Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
        setStatus((previous) => ({ ...previous, connectionLost: true }));
      }
      if (signal.aborted) return;
      controller = undefined;
      timer = setTimeout(() => void run(), delay);
    };
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      controller = undefined;
    };
    // Hidden tabs ask nothing; coming back asks at once, then at the usual pace.
    const onVisibility = () => {
      stop();
      if (!expired && document.visibilityState === "visible") void run();
    };
    if (document.visibilityState === "visible") void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, dayStart]);

  return { ...status, lastStartedPoll: () => pollsStarted.current };
}
