import { z } from "zod";
import { SESSION_STATES } from "./session-state";

/** A session as the office API sends it; dates are ISO strings. */
export const sessionDtoSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  state: z.enum(SESSION_STATES),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  /** Name on the desk; absent only when nothing is known yet. */
  deskName: z.string().optional(),
  /** Remote Control id; present only while Remote Control was connected. */
  bridgeSessionId: z.string().optional(),
  changedAt: z.string(),
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;

/** The office API's answer to "what changed since". */
export const changesResponseSchema = z.object({
  sessions: z.array(sessionDtoSchema),
  cursor: z.string(),
  serverNow: z.string(),
});

export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/** Overlap re-read on every poll: writes from several Macs can become visible out of stamp order. */
export const CHANGES_OVERLAP_MS = 5000;

/**
 * The map key for a session.
 * @param session - Any snapshot of it.
 * @returns "machineId/sessionId".
 */
export function sessionKey(
  session: Pick<SessionDto, "machineId" | "sessionId">,
): string {
  return `${session.machineId}/${session.sessionId}`;
}
