/** The states a session can be in, as the office shows them. */
export const SESSION_STATES = [
  "working",
  "thinking",
  "needsPermission",
  "waiting",
  "wentHome",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];
