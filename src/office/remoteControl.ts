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
