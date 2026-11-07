import type { SessionDto } from "@/shared/session";

/**
 * When the browser's local day began.
 * @param now - The current time.
 * @returns Local midnight at or before `now`.
 */
export function dayStartOf(now: Date): Date {
  // Built from calendar parts, not `now - 24h`, so a 23- or 25-hour DST day is still one day.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The sessions that went home today, newest first.
 * @param sessions - Every session the browser knows.
 * @param now - The current time.
 * @returns Prompted sessions that ended since local midnight.
 */
export function todaysDepartures(
  sessions: SessionDto[],
  now: Date,
): SessionDto[] {
  const start = dayStartOf(now).getTime();
  return sessions
    .filter(
      (session) =>
        session.hadPrompt === true &&
        session.endedAt !== undefined &&
        Date.parse(session.endedAt) >= start,
    )
    .sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? ""));
}
