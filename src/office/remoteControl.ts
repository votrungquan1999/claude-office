import type { SessionDto } from "@/shared/session";

const REMOTE_CONTROL_PREFIX = "https://claude.ai/code/";

/**
 * The Remote Control page for a session.
 * @param bridgeSessionId - The id Claude Code reports while Remote Control is connected.
 * @returns The page URL, or null when there is no safe id to link to.
 */
export function remoteControlUrl(
  bridgeSessionId: string | undefined,
): string | null {
  const id = bridgeSessionId?.trim();
  // Real ids never contain path or query characters; give no link rather than one to the wrong page.
  if (!id || /[/?#]/.test(id)) return null;
  return `${REMOTE_CONTROL_PREFIX}${encodeURIComponent(id)}`;
}

/**
 * The Remote Control page an employee's card links to.
 * @param session - The employee's session.
 * @returns The page URL, or null when it went home, has no process, is still opening, or has no safe id.
 */
export function remoteControlOf(
  session: Pick<
    SessionDto,
    "state" | "notRunning" | "waitingAtMac" | "starting" | "bridgeSessionId"
  >,
): string | null {
  const noProcess =
    session.state === "wentHome" ||
    session.notRunning ||
    session.waitingAtMac ||
    session.starting;
  return noProcess ? null : remoteControlUrl(session.bridgeSessionId);
}
