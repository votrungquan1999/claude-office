export interface OfficeHookEntry {
  hooks: Array<{ type: "command"; command: string; async: true }>;
}

/** Every event the office reads; none needs a matcher. */
export const OFFICE_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "Stop",
  "StopFailure",
  "Elicitation",
  "ElicitationResult",
  "SubagentStart",
  "SubagentStop",
] as const;

/**
 * The settings.json hook entries that feed the office.
 * @param home - The user's home folder.
 * @returns Entries keyed by hook event name.
 */
export function buildOfficeHookEntries(
  home: string,
): Record<string, OfficeHookEntry> {
  // Single quotes keep a path with spaces or `$` literal; `|| true` and the muted stderr mean a missing script or node never shows as a hook error.
  const script = `${home}/.claude/claude-office/hooks/claude-office-hook.mjs`;
  const command = `node '${script.replaceAll("'", "'\\''")}' 2>/dev/null || true`;
  // `async: true` keeps the session from waiting on the hook; no `timeout` since it is not enforced then.
  const entry: OfficeHookEntry = {
    hooks: [
      {
        type: "command",
        command,
        async: true,
      },
    ],
  };
  return Object.fromEntries(
    OFFICE_HOOK_EVENTS.map((event) => [event, structuredClone(entry)]),
  );
}
