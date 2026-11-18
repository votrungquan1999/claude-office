import { useEffect, useState } from "react";
import {
  pastDeparturesResponseSchema,
  type SessionDto,
} from "@/shared/session";

/** Waits for a pause in typing, so a word sends one search, not one per letter. */
const TYPING_PAUSE_MS = 250;

/** Where the search of earlier departures stands. */
export interface PastDepartures {
  /** The matches of the latest finished search, newest departure first. */
  sessions: SessionDto[];
  /** True while a search for the current query has not answered. */
  searching: boolean;
  /** True when the latest search failed. */
  failed: boolean;
}

/**
 * Searches the employees that went home before today, as the owner types.
 * @param query - What the owner typed.
 * @param dayStart - The browser's local midnight as ISO; departures from then on are already in the palette.
 * @returns The matches and how the search is going.
 */
export function usePastDepartures(
  query: string,
  dayStart: string,
): PastDepartures {
  const [result, setResult] = useState<PastDepartures & { query: string }>({
    query: "",
    sessions: [],
    searching: false,
    failed: false,
  });
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: trimmed, before: dayStart });
      try {
        const response = await fetch(`/api/office/past-departures?${params}`, {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = pastDeparturesResponseSchema.parse(await response.json());
        setResult({
          query: trimmed,
          sessions: body.sessions,
          searching: false,
          failed: false,
        });
      } catch {
        // A newer query aborted this one; its own search answers instead
        if (abort.signal.aborted) return;
        setResult({
          query: trimmed,
          sessions: [],
          searching: false,
          failed: true,
        });
      }
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [trimmed, dayStart]);
  if (!trimmed) return { sessions: [], searching: false, failed: false };
  // An answer for an older query must not show under the new one
  if (result.query !== trimmed) {
    return { sessions: [], searching: true, failed: false };
  }
  return result;
}
