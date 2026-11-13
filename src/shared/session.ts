import { z } from "zod";
import { folderDtoSchema } from "./folders";
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

/** A repo the session worked in: its display name and an opaque key that tells same-named repos apart. */
export const tagDtoSchema = z.object({
  name: z.string(),
  key: z.string(),
  /** The main repo's parent folder name, to tell same-named repos apart; absent on tags stored before it existed. */
  parent: z.string().optional(),
});

export type TagDto = z.infer<typeof tagDtoSchema>;

/** A session as the office API sends it; dates are ISO strings. */
export const sessionDtoSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  /** Folder the session was started in; `cwd` follows later `cd`s. Absent on rows written before it existed. */
  startCwd: z.string().optional(),
  state: z.enum(SESSION_STATES),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  /** Name on the desk; absent only when nothing is known yet. */
  deskName: z.string().optional(),
  /** The name the owner gave the employee; beats every automatic name. Absent when the owner gave none. */
  ownerName: z.string().optional(),
  /** The conversation's place in the owner's list: plain text sorted by character code; absent until the owner first moves a row. */
  rank: z.string().optional(),
  /** The original request: the typed first message, up to 2,000 characters; absent when the session has none. */
  request: z.string().optional(),
  /** Remote Control id; present only while Remote Control was connected. */
  bridgeSessionId: z.string().optional(),
  /** The 5 latest-started finished steps, oldest first; omitted for ended sessions. */
  recentSteps: z.array(stepDtoSchema).optional(),
  runningSteps: z.array(runningStepDtoSchema).optional(),
  /** The in-progress to-do line, when the session has one. */
  currentTodo: z.string().optional(),
  /** Repos the session worked in; absent when none. */
  tags: z.array(tagDtoSchema).optional(),
  /** Whether the session ever got a prompt; one that never did is left out of the went-home list. */
  hadPrompt: z.boolean().optional(),
  /** When the session entered its current room (Working and Thinking count as one), by the Mac's clock; absent on older rows. */
  stateSince: z.string().optional(),
  /** Set while the owner keeps the employee at its desk after hiring it; absent for every other session. */
  kept: z.enum(["hired", "woken"]).optional(),
  /** A kept employee whose Terminal window closed: still at its desk, idle, with nothing running. Absent means running. */
  notRunning: z.literal(true).optional(),
  /** A hired or woken employee whose window is probably at the folder-trust question; the owner answers it at the Mac. */
  waitingAtMac: z.literal(true).optional(),
  /** A hired or woken employee whose window is opening in a trusted folder; Claude Code has not registered yet. */
  starting: z.literal(true).optional(),
  changedAt: z.string(),
});

export type SessionDto = z.infer<typeof sessionDtoSchema>;

/** A Mac's last sign of life, stamped by the database clock. */
export const machineDtoSchema = z.object({
  machineId: z.string(),
  machineName: z.string(),
  lastSeenAt: z.string(),
  /** The agent's version; absent from agents older than the one that reports it. */
  agentVersion: z.string().optional(),
});

export type MachineDto = z.infer<typeof machineDtoSchema>;

/** The office API's answer to "what changed since". */
export const changesResponseSchema = z.object({
  sessions: z.array(sessionDtoSchema),
  /** Every Mac, on every answer: a Mac going quiet changes none of its sessions. */
  machines: z.array(machineDtoSchema),
  /** Every start folder of every Mac, on every answer, like `machines`. */
  folders: z.array(folderDtoSchema),
  cursor: z.string(),
  serverNow: z.string(),
});

export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/** What the page reads: a state it does not know shows as idle, so a newer server never freezes an open tab. */
export const pageChangesResponseSchema = changesResponseSchema.extend({
  sessions: z.array(
    sessionDtoSchema.extend({ state: z.enum(SESSION_STATES).catch("idle") }),
  ),
});

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

/** The Reviews the owner has looked at, each named by the `stateSince` the owner saw. */
export const reviewSeenRequestSchema = z.object({
  items: z
    .array(
      z.object({
        machineId: z.string().min(1),
        sessionId: z.string().min(1),
        stateSince: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(200),
});

export type ReviewSeenRequest = z.infer<typeof reviewSeenRequestSchema>;

/** The longest name the owner can give an employee, the same cut the automatic names get. */
export const OWNER_NAME_MAX_LENGTH = 60;

/** The owner's name for one employee; an empty name takes the owner's name away. */
export const ownerNameRequestSchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().max(OWNER_NAME_MAX_LENGTH),
});

export type OwnerNameRequest = z.infer<typeof ownerNameRequestSchema>;
