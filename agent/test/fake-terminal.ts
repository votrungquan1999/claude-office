import type { TerminalOpener } from "../terminal-launch";
import type { FakeHome, FakeSession } from "./fake-home";

export interface FakeTerminal {
  /** The opener the agent is given; records the script path and opens nothing. */
  open: TerminalOpener;
  /** Every script path the agent asked to open, in order. */
  opened: string[];
  /** Does what Claude Code does once the window runs: writes its registry entry. */
  startSession(
    sessionId: string,
    session: Omit<FakeSession, "sessionId">,
  ): void;
}

/**
 * A stand-in for the Terminal on a fake Mac.
 * @param fake - The Mac's fake home, where a started session registers itself.
 * @returns The opener to inject and the helpers to drive it.
 */
export function createFakeTerminal(fake: FakeHome): FakeTerminal {
  const opened: string[] = [];
  return {
    opened,
    open: async (scriptPath) => {
      opened.push(scriptPath);
    },
    startSession(sessionId, session) {
      fake.addSession({ entrypoint: "cli", ...session, sessionId });
    },
  };
}
