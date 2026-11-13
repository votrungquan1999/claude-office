import { ROOM_DISPLAY_NAMES, ROOM_OF_STATE } from "@/office/rooms";
import type { SessionDto } from "@/shared/session";

/** The state keys an employee's band or row can take: the session states plus the overlays that outrank them. */
export type BandKey =
  | SessionDto["state"]
  | "offline"
  | "notRunning"
  | "waitingAtMac"
  | "starting";

/** What a state word says and which colour key it takes. */
export interface StateWord {
  text: string;
  key: BandKey;
}

/**
 * What the state word says and which colour key it takes.
 * @param session - The session shown.
 * @param offline - Whether the session's Mac is offline.
 * @param options - `short` writes the permission room as "Needs you", for the card's narrow band.
 * @returns The word and its state key.
 */
export function bandOf(
  session: SessionDto,
  offline: boolean,
  { short = false }: { short?: boolean } = {},
): StateWord {
  if (session.state === "wentHome")
    return { text: "Went home", key: "wentHome" };
  // Still true when the Mac is offline: the window closed before that.
  if (session.notRunning) return { text: "Not running", key: "notRunning" };
  // A window the office opened that Claude Code has not registered yet outranks the Mac being offline.
  if (session.waitingAtMac)
    return { text: "Waiting at the Mac", key: "waitingAtMac" };
  if (session.starting) return { text: "Starting", key: "starting" };
  if (offline) return { text: "Mac offline", key: "offline" };
  // Thinking shares the Working room but keeps its own wording.
  if (session.state === "thinking")
    return { text: "Thinking", key: "thinking" };
  if (session.state === "needsPermission" && short)
    return { text: "Needs you", key: "needsPermission" };
  if (session.state === "review") return { text: "Review", key: "review" };
  const room = ROOM_OF_STATE[session.state];
  return {
    text: room ? ROOM_DISPLAY_NAMES[room] : "",
    key: session.state,
  };
}

/**
 * The step an employee is on, else the one it finished last.
 * @param session - The session shown.
 * @returns The latest running step, else the latest finished one; undefined when it has neither.
 */
export function lastStepOf(session: SessionDto) {
  return session.runningSteps?.at(-1) ?? session.recentSteps?.at(-1);
}

/**
 * The short line under a row's state word.
 * @param session - The session shown.
 * @param offline - Whether the session's Mac is offline.
 * @returns The line, or null when the state has none.
 */
export function contextLineOf(
  session: SessionDto,
  offline: boolean,
): string | null {
  // A word that is not a room has nothing running to describe.
  if (offline || session.notRunning || session.waitingAtMac || session.starting)
    return null;
  const running = session.runningSteps ?? [];
  switch (session.state) {
    case "working":
      return lastStepOf(session)?.text ?? "working…";
    case "thinking":
      return lastStepOf(session)?.text ?? null;
    case "needsPermission":
      // With several steps running nothing says which one asks.
      return running.length === 1
        ? `wants to run: ${running[0].text}`
        : "wants to run";
    case "waitingForYou":
      return "waiting for your reply";
    case "idle": {
      const last = lastStepOf(session)?.text;
      return last ? `last: ${last}` : null;
    }
    default:
      return null;
  }
}
