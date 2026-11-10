// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacBlock } from "@/office/offline";
import type { SessionDto } from "@/shared/session";
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

function open(
  s: SessionDto,
  offline: string[] = [],
  project?: string,
  serverOffsetMs?: number,
  tagLabels: ReadonlyMap<string, string> = new Map(),
  sheet = false,
) {
  render(
    <DetailsPanel
      session={s}
      project={project}
      tagLabels={tagLabels}
      serverOffsetMs={serverOffsetMs}
      offlineMachineIds={new Set(offline)}
      sheet={sheet}
      onClose={vi.fn()}
    />,
  );
}

/** Opens the panel with the wake props the page passes. */
function openWithWake(
  s: SessionDto,
  props: Partial<ComponentProps<typeof DetailsPanel>> = {},
) {
  return render(
    <DetailsPanel
      session={s}
      tagLabels={new Map()}
      offlineMachineIds={new Set()}
      sheet={false}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("the details panel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a state band worded for each of the seven states, in the room's data-state, and 'Mac offline' over any state when the Mac is offline", () => {
    // Given one panel per state, an offline Mac and a session that went home
    const cases: Array<[string, SessionDto, boolean, string, string]> = [
      ["working", session({ state: "working" }), false, "Working", "working"],
      [
        "thinking",
        session({ state: "thinking" }),
        false,
        "Thinking",
        "thinking",
      ],
      [
        "needsPermission",
        session({ state: "needsPermission" }),
        false,
        "Needs you",
        "needsPermission",
      ],
      [
        "waitingForYou",
        session({ state: "waitingForYou" }),
        false,
        "Waiting for you",
        "waitingForYou",
      ],
      ["idle", session({ state: "idle" }), false, "Idle", "idle"],
      [
        "offline",
        session({ state: "working" }),
        true,
        "Mac offline",
        "offline",
      ],
      [
        "wentHome",
        session({ state: "wentHome" }),
        false,
        "Went home",
        "wentHome",
      ],
    ];
    const shown = cases.map(([, s, offline]) => {
      open(s, offline ? ["m1"] : []);
      const seen = {
        text: screen.getByTestId("state-pill").textContent,
        state: screen.getByTestId("state-band").getAttribute("data-state"),
      };
      cleanup();
      return seen;
    });

    // Then each band names its state and carries the matching data-state
    expect(shown).toEqual(
      cases.map(([, , , text, state]) => ({ text, state })),
    );
  });

  it("shows the project under the band when there is one, and at most 3 repo tags with a +N for the rest", () => {
    // Given a session with a project and five tags
    const tags = ["a", "b", "c", "d", "e"].map((name) => ({
      name,
      key: `k${name}`,
    }));
    open(session({ tags }), [], "claude-office");

    // Then the project shows, three tags show and the rest collapse into "+2"
    expect(screen.getByTestId("project").textContent).toBe("claude-office");
    expect(screen.getAllByTestId("tag").map((el) => el.textContent)).toEqual([
      "#a",
      "#b",
      "#c",
    ]);
    expect(screen.getByTestId("tags-more").textContent).toBe("+2");
    cleanup();

    // And without a project or tags neither line shows
    open(session());
    expect(screen.queryByTestId("project")).toBeNull();
    expect(screen.queryByTestId("tag")).toBeNull();
    expect(screen.queryByTestId("tags-more")).toBeNull();
  });

  it("writes a tag as the company's label map says, so the card reads like the chips", () => {
    // Given a session with one tag the company wrote as parent/name, and one the map does not know
    const tags = [
      { name: "api", key: "1111aaaaaaaa", parent: "personal" },
      { name: "web", key: "2222bbbbbbbb" },
    ];

    // When the card opens with the company's label map
    open(
      session({ tags }),
      [],
      undefined,
      undefined,
      new Map([["1111aaaaaaaa", "personal/api"]]),
    );

    // Then the mapped tag reads parent/name and the other keeps its name
    expect(screen.getAllByTestId("tag").map((el) => el.textContent)).toEqual([
      "#personal/api",
      "#web",
    ]);
  });

  it("shows the running step in a terminal box with its time, ticking once a second", () => {
    // Given a working session whose step started 12 seconds ago
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    open(
      session({
        state: "working",
        runningSteps: [
          {
            text: "Inspect overlay label logic",
            startedAt: "2026-11-09T09:59:48Z",
          },
        ],
      }),
    );

    // Then the box shows the step and 12s
    expect(screen.getByTestId("terminal-text").textContent).toBe(
      "> Inspect overlay label logic",
    );
    expect(screen.getByTestId("terminal-time").textContent).toBe("12s");

    // When a second passes
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Then the time moves on
    expect(screen.getByTestId("terminal-time").textContent).toBe("13s");
  });

  it("reads the time against the server's clock and never shows a negative time", () => {
    // Given a step that started at 10:00:50 and a server clock 60 s ahead of this browser's
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const step = (startedAt: string) =>
      session({
        state: "working",
        runningSteps: [{ text: "Run tests", startedAt }],
      });
    open(step("2026-11-09T10:00:50Z"), [], undefined, 60_000);

    // Then the time counts from the server's now (10:01:00), not the browser's
    expect(screen.getByTestId("terminal-time").textContent).toBe("10s");
    cleanup();

    // And a step stamped in the future reads 0s
    open(step("2026-11-09T10:05:00Z"));
    expect(screen.getByTestId("terminal-time").textContent).toBe("0s");
  });

  it("words the terminal box for thinking, waiting, idle and working without a step, and hides it when the session went home or its Mac is offline", () => {
    const text = () =>
      screen.queryByTestId("terminal-text")?.textContent ?? null;
    const check = (s: SessionDto, offline: string[] = []) => {
      open(s, offline);
      const seen = text();
      cleanup();
      return seen;
    };

    // Then each state words its box
    expect(check(session({ state: "working" }))).toBe("> working…");
    expect(check(session({ state: "thinking" }))).toBe("> thinking…");
    expect(check(session({ state: "waitingForYou" }))).toBe(
      "> waiting for your reply",
    );
    expect(
      check(
        session({
          state: "idle",
          recentSteps: [
            {
              id: "1",
              text: "Old step",
              startedAt: "2026-11-09T09:00:00Z",
              status: "ok",
            },
            {
              id: "2",
              text: "Last step",
              startedAt: "2026-11-09T09:01:00Z",
              status: "ok",
            },
          ],
        }),
      ),
    ).toBe("> Last step");
    expect(check(session({ state: "idle" }))).toBeNull();
    expect(check(session({ state: "wentHome" }))).toBeNull();
    expect(check(session({ state: "working" }), ["m1"])).toBeNull();
  });

  it("shows what a session wants to run only when exactly one step runs, and the empty box otherwise", () => {
    const running = (...texts: string[]) =>
      session({
        state: "needsPermission",
        runningSteps: texts.map((text) => ({
          text,
          startedAt: "2026-11-09T09:59:48Z",
        })),
      });

    // Given one running step
    open(running("Run the e2e suite"));
    expect(screen.getByTestId("wants-to-run").textContent).toContain(
      "Wants to run",
    );
    expect(screen.getByTestId("wants-to-run-text").textContent).toBe(
      "Run the e2e suite",
    );
    cleanup();

    // And two running steps, so nothing says which one asks
    open(running("Read a.ts", "Run the e2e suite"));
    expect(screen.getByTestId("wants-to-run")).toBeTruthy();
    expect(screen.queryByTestId("wants-to-run-text")).toBeNull();
    cleanup();

    // And none (a notification without a tool)
    open(running());
    expect(screen.getByTestId("wants-to-run")).toBeTruthy();
    expect(screen.queryByTestId("wants-to-run-text")).toBeNull();
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

  it("gives the Remote Control link no target on the phone sheet, so iOS can hand it to the Claude app, with the same address and rel", () => {
    // Given a session with a Remote Control id on the phone layout
    open(
      session({ bridgeSessionId: "cse_abc" }),
      [],
      undefined,
      undefined,
      new Map(),
      true,
    );

    // Then the link has the same address and no target
    const link = screen.getByRole("link", { name: /Open Remote Control/ });
    expect(link.getAttribute("href")).toBe("https://claude.ai/code/cse_abc");
    expect(link.hasAttribute("target")).toBe(false);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("offers 'Open Remote Control' as a new-tab link when there is one, 'Approve in Remote Control' when it needs permission, keeps it on a Mac-offline card, otherwise a muted 'Remote Control off', and neither for a session that went home", () => {
    // Given a session with a Remote Control id
    open(session({ bridgeSessionId: "cse_abc" }));
    const link = screen.getByRole("link", { name: /Open Remote Control/ });
    expect(link.textContent).toBe("Open Remote Control ↗");
    expect(link.getAttribute("href")).toBe("https://claude.ai/code/cse_abc");
    expect(link.getAttribute("target")).toBe("_blank");
    cleanup();

    // And one that needs permission, and one whose Mac is offline
    open(session({ state: "needsPermission", bridgeSessionId: "cse_abc" }));
    expect(screen.getByRole("link").textContent).toBe(
      "Approve in Remote Control ↗",
    );
    cleanup();
    open(session({ bridgeSessionId: "cse_abc" }), ["m1"]);
    expect(screen.getByRole("link").textContent).toBe("Open Remote Control ↗");
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

  it("says 'No finished steps yet' for a session without steps and closes through the × button", () => {
    // Given a session with no steps
    const onClose = vi.fn();
    render(
      <DetailsPanel
        session={session()}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={onClose}
      />,
    );

    // Then the empty state shows, and the close button works
    expect(screen.getByText("No finished steps yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uppercases only the band's state word, never the elapsed time", () => {
    // Given a working session in its room for 4 min 6 s
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    open(session({ state: "working", stateSince: "2026-11-09T09:55:54Z" }));

    // Then the state word carries the uppercase style and the time does not
    expect(screen.getByTestId("state-pill").className).toContain("uppercase");
    expect(screen.getByTestId("state-time").className).not.toContain(
      "uppercase",
    );
    expect(screen.getByTestId("state-line").className).not.toContain(
      "uppercase",
    );
    expect(screen.getByTestId("state-time").textContent).toBe(" · 4m 06s");
  });

  it("shows how long the session has been in its state beside the band's word, ticking, and counts a went-home session from when it left", () => {
    // Given a working session in its room for 3 min 12 s
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const line = () => screen.getByTestId("state-line").textContent;
    open(session({ state: "working", stateSince: "2026-11-09T09:56:48Z" }));
    expect(line()).toBe("Working · 3m 12s");

    // When a second passes
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Then the time moves on
    expect(line()).toBe("Working · 3m 13s");
    cleanup();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));

    // And hours read "1h 05m", a thinking session keeps counting, and a went-home session counts from when it left
    open(session({ state: "thinking", stateSince: "2026-11-09T08:55:00Z" }));
    expect(line()).toBe("Thinking · 1h 05m");
    cleanup();
    open(session({ state: "wentHome", stateSince: "2026-11-09T09:30:00Z" }));
    expect(line()).toBe("Went home · 30m 00s");
  });

  it("shows no time on a Mac-offline band or when the session has no stamp, and never a negative time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const line = () => screen.getByTestId("state-line").textContent;

    // Given a Mac that is offline, then a legacy row without a stamp
    open(session({ state: "working", stateSince: "2026-11-09T09:56:48Z" }), [
      "m1",
    ]);
    expect(line()).toBe("Mac offline");
    cleanup();
    open(session({ state: "working" }));
    expect(line()).toBe("Working");
    cleanup();

    // And a stamp in the future (the Mac's clock is ahead) reads 0s
    open(session({ state: "idle", stateSince: "2026-11-09T10:10:00Z" }));
    expect(line()).toBe("Idle · 0s");
  });

  it("stops its once-a-second clock when the panel closes", () => {
    vi.useFakeTimers();

    // Given an open panel that is counting
    open(session({ state: "working", stateSince: "2026-11-09T09:56:48Z" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // When it closes
    cleanup();

    // Then no timer is left running
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says 'Not running' with the time since the window closed, and shows no terminal box, Remote Control link or 'Remote Control off' line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));

    // Given a kept employee whose window closed four minutes ago
    open(
      session({
        state: "idle",
        kept: "hired",
        bridgeSessionId: "bridge-closed",
        notRunning: true,
        stateSince: "2026-11-09T09:56:00Z",
        recentSteps: [
          {
            id: "a",
            text: "Ran the build",
            startedAt: "2026-11-09T09:50:00Z",
            status: "ok",
          },
        ],
      }),
    );

    // Then the band reads "Not running" with the time, and nothing offers a link or a status box
    expect(screen.getByTestId("state-line").textContent).toBe(
      "Not running · 4m 00s",
    );
    expect(screen.getByTestId("state-band").dataset.state).toBe("notRunning");
    expect(screen.queryByTestId("terminal-box")).toBeNull();
    expect(screen.queryByTestId("remote-control-link")).toBeNull();
    expect(screen.queryByText("Remote Control off")).toBeNull();
  });

  it("says 'Waiting at the Mac' with what to do there for a hire stopped at the folder-trust question, and offers no Remote Control line or approval box", () => {
    // Given a hired employee waiting at the Mac in the Needs permission state
    open(
      session({
        state: "needsPermission",
        kept: "hired",
        waitingAtMac: true,
        deskName: "Fix the login bug",
      }),
    );

    // Then the band says it and the card names the folder trust and the window, with nothing to approve or open
    expect(screen.getByTestId("state-pill").textContent).toBe(
      "Waiting at the Mac",
    );
    expect(screen.getByTestId("state-band").dataset.state).toBe("waitingAtMac");
    expect(screen.getByTestId("launch-note").textContent).toContain(
      "trust the folder",
    );
    expect(screen.getByTestId("launch-note").textContent).toContain(
      "click the window",
    );
    expect(screen.queryByTestId("wants-to-run")).toBeNull();
    expect(screen.queryByTestId("remote-control-link")).toBeNull();
    expect(screen.queryByText("Remote Control off")).toBeNull();
  });

  it("says 'Starting' for a hire opening in a trusted folder, and keeps that over 'Mac offline'", () => {
    // Given a starting hired employee on a Mac that is offline
    open(session({ state: "idle", kept: "hired", starting: true }), ["m1"]);

    // Then the band says Starting, the note says it is starting on the Mac, and there is no link
    expect(screen.getByTestId("state-pill").textContent).toBe("Starting");
    expect(screen.getByTestId("launch-note").textContent).toBe(
      "Starting on the Mac.",
    );
    expect(screen.queryByTestId("remote-control-link")).toBeNull();
    expect(screen.queryByText("Remote Control off")).toBeNull();
  });

  it("offers Wake for a went-home or not-running employee, never for a running, waiting or starting one, and one click sends one wake", () => {
    // Given the panel for each kind of employee
    const wakeable = [
      session({ state: "wentHome", endedAt: new Date().toISOString() }),
      session({ state: "idle", kept: "hired", notRunning: true }),
    ];
    const notWakeable = [
      session({ state: "thinking" }),
      session({ state: "needsPermission", kept: "hired", waitingAtMac: true }),
      session({ state: "idle", kept: "hired", starting: true }),
    ];

    // Then only the first two show a Wake button
    for (const s of notWakeable) {
      openWithWake(s, { onWake: vi.fn() });
      expect(screen.queryByTestId("wake-button")).toBeNull();
      cleanup();
    }

    // When the owner clicks Wake, and again while the page's wake is still in flight
    const onWake = vi.fn();
    for (const s of wakeable) {
      openWithWake(s, { onWake });
      expect(screen.getByTestId("wake-button").textContent).toBe("Wake");
      cleanup();
    }
    const { rerender } = openWithWake(wakeable[0], { onWake });
    fireEvent.click(screen.getByTestId("wake-button"));
    rerender(
      <DetailsPanel
        session={wakeable[0]}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={vi.fn()}
        onWake={onWake}
        wake={{ sending: true }}
      />,
    );
    fireEvent.click(screen.getByTestId("wake-button"));

    // Then one wake went out and the button reads disabled while it is in flight
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables Wake for an offline Mac and for an out-of-date agent, saying to update it, and keeps it enabled for a Mac that can take orders", () => {
    const wentHome = session({
      state: "wentHome",
      endedAt: new Date().toISOString(),
    });

    // Given the panel on a Mac that is online and current
    openWithWake(wentHome, { onWake: vi.fn() });
    // Then Wake works and nothing explains a block
    expect(
      (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByTestId("wake-note")).toBeNull();
    cleanup();

    // Given an offline Mac
    openWithWake(wentHome, { onWake: vi.fn(), macBlock: MacBlock.Offline });
    // Then Wake is disabled
    expect(
      (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    // Given an agent that is out of date
    openWithWake(wentHome, { onWake: vi.fn(), macBlock: MacBlock.Outdated });
    // Then Wake is disabled and the card says to update the agent
    expect(
      (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("wake-note").textContent).toMatch(
      /update this Mac's agent/i,
    );
  });

  it("warns that the employee will wait at the Mac when its start folder is not trusted, and not for a trusted or unjudged one", () => {
    const wentHome = session({
      state: "wentHome",
      endedAt: new Date().toISOString(),
      startCwd: "/work/app",
      cwd: "/work/app/src",
    });
    const record = (path: string, cliTrusted?: boolean) => ({
      machineId: "m1",
      path,
      companyMode: true,
      ...(cliTrusted === undefined ? {} : { cliTrusted }),
    });

    // Given the start folder is refused, then trusted, then unjudged
    openWithWake(wentHome, { folders: [record("/work/app", false)] });
    expect(screen.getByTestId("wake-trust-warning").textContent).toContain(
      "will wait at the Mac for you to trust this folder",
    );
    cleanup();
    openWithWake(wentHome, { folders: [record("/work/app", true)] });
    expect(screen.queryByTestId("wake-trust-warning")).toBeNull();
    cleanup();
    openWithWake(wentHome, {
      folders: [record("/work/app"), record("/work/app/src", false)],
    });

    // Then only the refused start folder warns (the later cwd is not the start folder)
    expect(screen.queryByTestId("wake-trust-warning")).toBeNull();
  });

  describe("the outcome of a wake order", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const wentHome = () =>
      session({ state: "wentHome", endedAt: new Date().toISOString() });

    it("says 'Waking…' while pending and disables Wake, then 'Not woken: open elsewhere' when the Mac refused it", async () => {
      // Given an order the Mac has not picked up, then one it failed as open elsewhere
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "pending", ageMs: 100 })),
        )
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "failed",
              reason: "openElsewhere",
              ageMs: 3000,
            }),
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.useFakeTimers();

      // When the panel follows the order
      openWithWake(wentHome(), { wake: { orderId: "o1" }, onWake: vi.fn() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Then it says waking and the button is disabled
      expect(screen.getByTestId("wake-outcome").textContent).toBe("Waking…");
      expect(
        (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
      ).toBe(true);

      // When the next answer says it failed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // Then the card says why, and Wake can be tried again
      expect(screen.getByTestId("wake-outcome").textContent).toBe(
        "Not woken: open elsewhere.",
      );
      expect(
        (screen.getByTestId("wake-button") as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it("shows the server's refusal as sent, and 'Not sent' for an order the Mac never picked up", async () => {
      // Given a refusal text from the server
      openWithWake(wentHome(), {
        wake: { error: "That Mac is offline." },
        onWake: vi.fn(),
      });

      // Then it shows
      expect(screen.getByTestId("wake-outcome").textContent).toBe(
        "That Mac is offline.",
      );
      cleanup();

      // Given an order the office reports unclaimed after 30 s
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ status: "pending", ageMs: 31_000 })),
          ),
      );
      vi.useFakeTimers();
      openWithWake(wentHome(), { wake: { orderId: "o2" }, onWake: vi.fn() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Then the card says it was not sent
      expect(screen.getByTestId("wake-outcome").textContent).toMatch(
        /^Not sent/,
      );
    });
  });

  it("offers Dismiss for a kept employee in any state, never for a plain one, and one click sends one dismiss", () => {
    // Given the panel for each kind of kept employee and for plain ones
    const kept = [
      session({ state: "thinking", kept: "hired" }),
      session({ state: "idle", kept: "woken", notRunning: true }),
      session({ state: "needsPermission", kept: "hired", waitingAtMac: true }),
      session({ state: "idle", kept: "woken", starting: true }),
    ];
    const plain = [
      session({ state: "thinking" }),
      session({ state: "wentHome", endedAt: new Date().toISOString() }),
    ];

    // Then only the kept ones show a Dismiss button
    for (const s of plain) {
      openWithWake(s, { onDismiss: vi.fn() });
      expect(screen.queryByTestId("dismiss-button")).toBeNull();
      cleanup();
    }
    const onDismiss = vi.fn();
    for (const s of kept) {
      openWithWake(s, { onDismiss });
      expect(screen.getByTestId("dismiss-button").textContent).toBe("Dismiss");
      cleanup();
    }

    // When the owner clicks Dismiss, and again while the page's dismiss is still in flight
    const { rerender } = openWithWake(kept[0], { onDismiss });
    fireEvent.click(screen.getByTestId("dismiss-button"));
    rerender(
      <DetailsPanel
        session={kept[0]}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        dismiss={{ sending: true }}
      />,
    );
    fireEvent.click(screen.getByTestId("dismiss-button"));

    // Then one dismiss went out and the button reads disabled while it is in flight
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("dismiss-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables Dismiss for an offline Mac and for an out-of-date agent, saying to update it, and keeps it enabled for a Mac that can take orders", () => {
    const hired = session({ state: "thinking", kept: "hired" });
    const dismissButton = () =>
      screen.getByTestId("dismiss-button") as HTMLButtonElement;

    // When the Mac can take orders
    openWithWake(hired, { onDismiss: vi.fn() });
    // Then Dismiss works and nothing explains a block
    expect(dismissButton().disabled).toBe(false);
    expect(screen.queryByTestId("dismiss-note")).toBeNull();
    cleanup();

    // When the Mac is offline
    openWithWake(hired, { onDismiss: vi.fn(), macBlock: MacBlock.Offline });
    // Then Dismiss is disabled
    expect(dismissButton().disabled).toBe(true);
    cleanup();

    // When the Mac's agent is out of date
    openWithWake(hired, { onDismiss: vi.fn(), macBlock: MacBlock.Outdated });
    // Then Dismiss is disabled and the card says to update the agent
    expect(dismissButton().disabled).toBe(true);
    expect(screen.getByTestId("dismiss-note").textContent).toMatch(
      /update this Mac's agent/i,
    );
  });

  describe("the outcome of a dismiss order", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const hired = () => session({ state: "thinking", kept: "hired" });

    it("says 'Dismissing…' while pending and disables Dismiss, then why it failed when the Mac could not do it", async () => {
      // Given an order the Mac has not picked up, then one it failed
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "pending", ageMs: 100 })),
        )
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "failed",
              reason: "interrupted",
              ageMs: 3000,
            }),
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.useFakeTimers();

      // When the panel follows the order
      openWithWake(hired(), { dismiss: { orderId: "o1" }, onDismiss: vi.fn() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Then it says dismissing and the button is disabled
      expect(screen.getByTestId("dismiss-outcome").textContent).toBe(
        "Dismissing…",
      );
      expect(
        (screen.getByTestId("dismiss-button") as HTMLButtonElement).disabled,
      ).toBe(true);

      // When the next answer says it failed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // Then the card says why, and Dismiss can be tried again
      expect(screen.getByTestId("dismiss-outcome").textContent).toMatch(
        /^Not dismissed: the Mac's agent restarted/,
      );
      expect(
        (screen.getByTestId("dismiss-button") as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it("shows the server's refusal as sent", () => {
      // Given a refusal text from the server
      openWithWake(hired(), {
        dismiss: { error: "That Mac is offline." },
        onDismiss: vi.fn(),
      });

      // Then it shows
      expect(screen.getByTestId("dismiss-outcome").textContent).toBe(
        "That Mac is offline.",
      );
    });
  });
});
