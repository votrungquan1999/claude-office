// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDto } from "@/shared/session";
import type { SessionState } from "@/shared/session-state";
import { DetailsPanel } from "./DetailsPanel";

function session(extra: Partial<SessionDto> = {}): SessionDto {
  return {
    machineId: "m1",
    machineName: "Quan's MacBook Pro",
    sessionId: "s1",
    cwd: "/Users/q/Documents/git-repos/personal/claude-office",
    state: "thinking",
    startedAt: new Date().toISOString(),
    changedAt: new Date().toISOString(),
    ...extra,
  };
}

function open(s: SessionDto, offline: string[] = []) {
  render(
    <DetailsPanel
      session={s}
      offlineMachineIds={new Set(offline)}
      sheet={false}
      onClose={vi.fn()}
    />,
  );
}

describe("the details panel", () => {
  afterEach(cleanup);

  it("shows a state pill worded for the state, and a grey 'Mac offline' pill when the Mac is offline", () => {
    // Given one panel per state
    const states: Array<[SessionState, string]> = [
      ["working", "Working"],
      ["thinking", "Thinking"],
      ["needsPermission", "Needs permission"],
      ["waiting", "Waiting"],
    ];
    const shown = states.map(([state]) => {
      open(session({ state }));
      const text = screen.getByTestId("state-pill").textContent;
      cleanup();
      return text;
    });
    // And one for a session whose Mac is offline
    open(session(), ["m1"]);

    // Then each pill names its state, and the offline Mac overrides it
    expect(shown).toEqual(states.map(([, text]) => text));
    expect(screen.getByTestId("state-pill").textContent).toBe("Mac offline");
    expect(screen.getByTestId("state-pill").getAttribute("data-state")).toBe(
      "offline",
    );
  });

  it("writes the home folder as ~, cuts a long path in the middle, and keeps the full path in the title", () => {
    // Given a deep folder under the home folder
    open(session());

    // Then the folder is shortened, and hovering gives the full path
    const folder = screen.getByTestId("folder");
    expect(folder.textContent).toBe("~/…/claude-office");
    expect(folder.getAttribute("title")).toBe(
      "/Users/q/Documents/git-repos/personal/claude-office",
    );
    cleanup();

    // And a short folder only swaps the home prefix, and a path outside home stays as it is
    open(session({ cwd: "/Users/q/work/app" }));
    expect(screen.getByTestId("folder").textContent).toBe("~/work/app");
    cleanup();
    open(session({ cwd: "/srv/app" }));
    expect(screen.getByTestId("folder").textContent).toBe("/srv/app");
  });

  it("offers 'Open in Remote Control' as a new-tab link when there is one, otherwise a muted 'Remote Control off', and neither for a session that went home", () => {
    // Given a session with a Remote Control id
    open(session({ bridgeSessionId: "cse_abc" }));
    const link = screen.getByRole("link", { name: /Open in Remote Control/ });
    expect(link.textContent).toBe("Open in Remote Control ↗");
    expect(link.getAttribute("href")).toBe("https://claude.ai/code/cse_abc");
    expect(link.getAttribute("target")).toBe("_blank");
    cleanup();

    // And one without
    open(session());
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Remote Control off")).toBeTruthy();
    cleanup();

    // And one that went home
    open(session({ state: "wentHome", bridgeSessionId: "cse_abc" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Remote Control/)).toBeNull();
  });

  it("says 'No steps yet' for a session without steps and closes through the × button", () => {
    // Given a session with no steps
    const onClose = vi.fn();
    render(
      <DetailsPanel
        session={session()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={onClose}
      />,
    );

    // Then the empty state shows, and the close button works
    expect(screen.getByText("No steps yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
