import type { SessionCompany } from "@/shared/companies";
import { employeeName } from "@/shared/employee-name";
import { type SessionDto, sessionKey } from "@/shared/session";
import { lookOf } from "./sceneSync";

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

/**
 * The sessions a search reads: every live one and today's departures.
 * @param sessions - Every session the browser knows.
 * @param now - The current time.
 * @returns Live sessions, then today's departures newest first.
 */
export function searchableSessions(
  sessions: SessionDto[],
  now: Date,
): SessionDto[] {
  return [
    ...sessions.filter((session) => session.state !== "wentHome"),
    ...todaysDepartures(sessions, now),
  ];
}

/**
 * When a conversation went home, as the Went home lists write it.
 * @param endedAt - ISO time it ended.
 * @returns Local HH:MM.
 */
export function wentHomeTime(endedAt: string): string {
  return new Date(endedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One went-home conversation as the drawer and the lists write it. */
export interface WentHomeRowData {
  /** Session key, which opens its details. */
  key: string;
  palette: number;
  hueShift: number;
  /** The task name in full. */
  task: string;
  /** `Mac / company/project`. */
  where: string;
  /** Local HH:MM it went home. */
  time: string;
}

/**
 * The went-home rows of a list of departures.
 * @param departures - Today's departures, newest first.
 * @param companyOf - The company and project a session belongs to.
 * @returns One row per departure, in the same order.
 */
export function wentHomeRowsOf(
  departures: SessionDto[],
  companyOf: (session: SessionDto) => SessionCompany | null | undefined,
): WentHomeRowData[] {
  return departures.map((session) => {
    const key = sessionKey(session);
    const placed = companyOf(session);
    return {
      key,
      ...lookOf(key),
      task: employeeName(session),
      // A part that is not known is left out rather than printed as "undefined"
      where: [
        session.machineName,
        placed &&
          `${placed.companyName}${placed.project ? `/${placed.project}` : ""}`,
      ]
        .filter(Boolean)
        .join(" / "),
      time: wentHomeTime(session.endedAt ?? ""),
    };
  });
}
