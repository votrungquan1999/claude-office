import { z } from "zod";
import { SESSION_STATES } from "./session-state";

/** How a finished step ended. */
export const STEP_STATUSES = ["ok", "failed", "denied", "stopped"] as const;

/** One finished step in plain words; dates are ISO strings. */
export const stepDtoSchema = z.object({
  /** Shared by the session's recent list and the `steps` collection, so the two can be told apart. */
  id: z.string(),
  text: z.string(),
  startedAt: z.string(),
  /** Run time; absent when it could not be known (a step closed while still running). */
  durationMs: z.number().optional(),
  status: z.enum(STEP_STATUSES),
});

export type StepDto = z.infer<typeof stepDtoSchema>;

/** A step that has started and not finished. */
export const runningStepDtoSchema = z.object({
  text: z.string(),
  startedAt: z.string(),
});

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
  /** The 5 latest-started finished steps, oldest first; omitted for ended sessions. */
  recentSteps: z.array(stepDtoSchema).optional(),
  runningSteps: z.array(runningStepDtoSchema).optional(),
  /** The in-progress to-do line, when the session has one. */
  currentTodo: z.string().optional(),
  /** Whether the session ever got a prompt; one that never did is left out of the went-home list. */
  hadPrompt: z.boolean().optional(),
  changedAt: z.string(),
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;

/** A Mac's last sign of life, stamped by the database clock. */
export const machineDtoSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  lastSeenAt: z.string(),
});

export type MachineDto = z.infer<typeof machineDtoSchema>;

/** The office API's answer to "what changed since". */
export const changesResponseSchema = z.object({
  sessions: z.array(sessionDtoSchema),
  /** Every Mac, on every answer: a Mac going quiet changes none of its sessions. */
  machines: z.array(machineDtoSchema),
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

/** One page of a session's older steps, newest first. */
export const stepsPageSchema = z.object({
  steps: z.array(stepDtoSchema),
  /** Pass as `before` for the next page; absent on the last page. */
  next: z.string().optional(),
});

export type StepsPage = z.infer<typeof stepsPageSchema>;
