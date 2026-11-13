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

  it("shows the latest running step when several run at once, the same one the list row shows", () => {
    // Given a working session with two steps running
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    open(
      session({
        state: "working",
        runningSteps: [
          { text: "Read a.ts", startedAt: "2026-11-09T09:59:00Z" },
          { text: "Edit b.ts", startedAt: "2026-11-09T09:59:48Z" },
        ],
      }),
    );

    // Then the box shows the later step and counts from its start
    expect(screen.getByTestId("terminal-text").textContent).toBe("> Edit b.ts");
    expect(screen.getByTestId("terminal-time").textContent).toBe("12s");
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

  it("offers Dismiss for a kept employee in any state and never for a plain one", () => {
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
    for (const s of kept) {
      openWithWake(s, { onDismiss: vi.fn() });
      expect(screen.getByTestId("dismiss-button").textContent).toBe("Dismiss");
      cleanup();
    }
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

    it("shows the note of a done dismiss, such as a window left open, once the employee is no longer kept, and offers no second Dismiss", async () => {
      // Given a dismiss that is done with a note, for an employee the agent has already stopped keeping
      const home = session({ state: "wentHome" });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "done",
              note: "Ended, but its Terminal window stays open. Close it yourself.",
              ageMs: 900,
            }),
          ),
        ),
      );

      // When the panel follows the order
      openWithWake(home, { dismiss: { orderId: "o1" }, onDismiss: vi.fn() });

      // Then the card shows the note and no Dismiss button
      const note = await screen.findByText(
        "Ended, but its Terminal window stays open. Close it yourself.",
      );
      expect(note.getAttribute("data-testid")).toBe("dismiss-outcome");
      expect(screen.queryByTestId("dismiss-button")).toBeNull();
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

  it("shows a Review employee's band with its time and last step, a Move to Idle button with its explanation and no finished-result block, and one click moves it once", () => {
    // Given a Review that began 18 min 5 s ago with two finished steps
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const onMoveToIdle = vi.fn();

    // When the card opens
    openWithWake(
      session({
        state: "review",
        stateSince: "2026-11-09T09:41:55Z",
        recentSteps: [
          {
            id: "1",
            text: "Old step",
            startedAt: "2026-11-09T09:00:00Z",
            status: "ok",
          },
          {
            id: "2",
            text: "Wrote the summary",
            startedAt: "2026-11-09T09:01:00Z",
            status: "ok",
          },
        ],
      }),
      { onMoveToIdle },
    );

    // Then the band reads Review with the time in it, over the last step
    expect(screen.getByTestId("state-line").textContent).toBe(
      "Review · 18m 05s",
    );
    expect(screen.getByTestId("state-band").getAttribute("data-state")).toBe(
      "review",
    );
    expect(screen.getByTestId("terminal-text").textContent).toBe(
      "> Wrote the summary",
    );

    // And Move to Idle comes with its one-line explanation, and nothing says the work is finished
    expect(screen.getByTestId("move-to-idle-note").textContent).toBe(
      "Moving to Idle means you have seen the result. It stays in your list, in the same place.",
    );
    expect(screen.queryByText(/finished, ready/i)).toBeNull();

    // And one click moves it once
    fireEvent.click(screen.getByRole("button", { name: "Move to Idle" }));
    expect(onMoveToIdle).toHaveBeenCalledTimes(1);
  });

  it("offers Move to Idle for a Review employee whose Mac is offline, and for no other state", () => {
    // Given a Review employee on an offline Mac
    open(session({ state: "review" }), ["m1"]);

    // Then the band says the Mac is offline and Move to Idle is still there
    expect(screen.getByTestId("state-pill").textContent).toBe("Mac offline");
    expect(screen.getByRole("button", { name: "Move to Idle" })).toBeTruthy();
    cleanup();

    // And no other state offers it
    for (const state of [
      "idle",
      "waitingForYou",
      "needsPermission",
      "working",
      "wentHome",
    ] as const) {
      open(session({ state }));
      expect(screen.queryByRole("button", { name: "Move to Idle" })).toBeNull();
      cleanup();
    }
  });

  it("says a refused Move to Idle did not go through, in an alert beside the button, and shows no alert otherwise", () => {
    // Given a Review card with no refusal
    const { rerender } = openWithWake(session({ state: "review" }));
    expect(screen.queryByRole("alert")).toBeNull();

    // When the page passes the refusal
    rerender(
      <DetailsPanel
        session={session({ state: "review" })}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={vi.fn()}
        moveToIdleError="Could not move to Idle. Try again."
      />,
    );

    // Then the card says so
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not move to Idle. Try again.",
    );
  });
});

describe("the Dismiss pop-up", () => {
  afterEach(cleanup);

  const pressDismiss = () =>
    fireEvent.click(screen.getByTestId("dismiss-button"));
  const popup = () =>
    screen.queryByRole("dialog", { name: "Dismiss employee" });

  it("does not promise a later wake when the employee never had a prompt, since nothing will appear in Went home", () => {
    // Given the card of a hired employee that was never given a request
    openWithWake(session({ state: "idle", kept: "hired" }), {
      onDismiss: vi.fn(),
    });

    // When the owner presses Dismiss
    pressDismiss();

    // Then the pop-up says it will not appear in Went home and does not offer a wake
    const text = popup()?.textContent ?? "";
    expect(text).toContain("it will not appear in Went home");
    expect(text).not.toContain("wake it again");
  });

  it("opens a pop-up that names the Mac and sends nothing, and its confirm button sends exactly one dismiss and closes it", () => {
    // Given the card of a hired employee that is idle
    const onDismiss = vi.fn();
    openWithWake(session({ state: "idle", kept: "hired", hadPrompt: true }), {
      onDismiss,
    });

    // When the owner presses Dismiss
    pressDismiss();

    // Then a modal pop-up explains the window is still open on the Mac, and no order went out
    expect(popup()?.getAttribute("aria-modal")).toBe("true");
    expect(popup()?.textContent).toContain(
      "This conversation is still open in a Terminal window on Quan's MacBook Pro. Dismiss ends it and closes the window; you can wake it again later.",
    );
    expect(onDismiss).not.toHaveBeenCalled();

    // When the owner presses the pop-up's Dismiss twice
    const confirm = screen.getByTestId("dismiss-confirm");
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // Then one dismiss went out and the pop-up is gone
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(popup()).toBeNull();
  });

  it("sends nothing when the owner cancels with Cancel, Escape or the backdrop, starts on Cancel, and gives focus back to the Dismiss button", () => {
    // Given a hired employee and a sent-nothing counter
    const onDismiss = vi.fn();
    openWithWake(session({ state: "idle", kept: "hired" }), { onDismiss });

    // When the pop-up opens
    pressDismiss();

    // Then focus starts on the safe choice
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );

    // When the owner cancels with the button, Escape, then the backdrop
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(popup()).toBeNull();
    pressDismiss();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(popup()).toBeNull();
    pressDismiss();
    fireEvent.click(screen.getByTestId("dismiss-backdrop"));
    expect(popup()).toBeNull();

    // Then focus is back on the Dismiss button and nothing was ever sent
    expect(document.activeElement).toBe(screen.getByTestId("dismiss-button"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("adds a strong warning for an employee that is working, thinking or waiting on your permission, and none for any other state or a window still opening", () => {
    // Given what the pop-up says for each kind of hired employee
    const warningFor = (extra: Partial<SessionDto>) => {
      const { unmount } = openWithWake(session({ kept: "hired", ...extra }), {
        onDismiss: vi.fn(),
      });
      pressDismiss();
      const text = popup()?.textContent ?? "";
      unmount();
      return /dismissing stops it/.test(text) ? text : null;
    };

    // Then working and thinking say it is working, needs permission says it waits on the owner
    expect(warningFor({ state: "working" })).toContain(
      "It is working right now; dismissing stops it.",
    );
    expect(warningFor({ state: "thinking" })).toContain(
      "It is working right now; dismissing stops it.",
    );
    expect(warningFor({ state: "needsPermission" })).toContain(
      "It is waiting for your permission; dismissing stops it.",
    );

    // And every other state, and a window at the trust question or still starting, get the plain wording only
    for (const extra of [
      { state: "idle" },
      { state: "waitingForYou" },
      { state: "review" },
      { state: "needsPermission", waitingAtMac: true },
      { state: "idle", starting: true },
    ] as Array<Partial<SessionDto>>) {
      expect(warningFor(extra)).toBeNull();
    }
  });

  it("dismisses a Not running employee at once with one click, since it has no window process to explain", () => {
    // Given a hired employee whose window already closed
    const onDismiss = vi.fn();
    const notRunning = session({
      state: "idle",
      kept: "woken",
      notRunning: true,
    });
    const { rerender } = openWithWake(notRunning, { onDismiss });

    // When the owner presses Dismiss, and again while the dismiss is in flight
    pressDismiss();
    rerender(
      <DetailsPanel
        session={notRunning}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        dismiss={{ sending: true }}
      />,
    );
    pressDismiss();

    // Then no pop-up appeared, one dismiss went out without asking to end a conversation, and the button reads disabled
    expect(popup()).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(false);
    expect(
      (screen.getByTestId("dismiss-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("follows the live card: when the Mac goes offline while the pop-up is open its Dismiss is disabled, and when the employee stops working the strong warning goes", () => {
    // Given the pop-up open for a working hire
    const onDismiss = vi.fn();
    const working = session({ state: "working", kept: "hired" });
    const panel = (s: SessionDto, macBlock?: MacBlock) => (
      <DetailsPanel
        session={s}
        tagLabels={new Map()}
        offlineMachineIds={new Set()}
        sheet={false}
        onClose={vi.fn()}
        onDismiss={onDismiss}
        macBlock={macBlock}
      />
    );
    const { rerender } = render(panel(working));
    pressDismiss();
    expect(popup()?.textContent).toContain("dismissing stops it");

    // When it goes idle and its Mac then goes offline
    rerender(panel({ ...working, state: "idle" }));
    expect(popup()?.textContent).not.toContain("dismissing stops it");
    rerender(panel({ ...working, state: "idle" }, MacBlock.Offline));

    // Then the pop-up's Dismiss is disabled and sends nothing
    const confirm = screen.getByTestId("dismiss-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("says the window stays open and has to be closed at the Mac when the Mac's agent is too old to close it, and still sends the same single dismiss", () => {
    // Given a hired, working employee on a Mac whose agent cannot close windows
    const onDismiss = vi.fn();
    openWithWake(session({ state: "working", kept: "hired" }), {
      onDismiss,
      dismissClosesWindow: false,
    });

    // When the owner opens the pop-up
    pressDismiss();

    // Then it promises no window closing, and the strong warning still shows
    const text = popup()?.textContent ?? "";
    expect(text).toContain("your window stays open; close it at the Mac");
    expect(text).not.toContain("closes the window");
    expect(text).toContain("It is working right now; dismissing stops it.");

    // And confirming sends one dismiss
    fireEvent.click(screen.getByTestId("dismiss-confirm"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("renaming an employee from its card", () => {
  afterEach(cleanup);

  it("opens a dialog from the pencil that shows the automatic name and the owner's name, and Enter sends the typed name once and closes it", async () => {
    // Given a card whose employee already has an owner's name over its automatic one
    const onRename = vi.fn().mockResolvedValue(true);
    openWithWake(
      session({ deskName: "Fix the login bug", ownerName: "Login fixer" }),
      { onRename },
    );

    // When the owner presses the pencil
    fireEvent.click(screen.getByRole("button", { name: "Rename employee" }));

    // Then a modal dialog asks for the name, filled with the owner's name, and says what an empty name does
    const dialog = screen.getByRole("dialog", { name: "Rename employee" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Login fixer");
    expect(dialog.textContent).toContain(
      'Leave it empty to get the automatic name back: "Fix the login bug".',
    );

    // When the owner types a new name and presses Enter
    fireEvent.change(input, { target: { value: "  Bug squasher " } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    // Then one rename is sent with the typed name and the dialog is gone
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Bug squasher");
    expect(
      screen.queryByRole("dialog", { name: "Rename employee" }),
    ).toBeNull();
  });

  it("sends nothing when the owner cancels with Escape, the Cancel button or the backdrop, or saves the name as it stands", async () => {
    // Given a card with an owner's name
    const onRename = vi.fn().mockResolvedValue(true);
    openWithWake(session({ ownerName: "Login fixer" }), { onRename });
    const dialog = () =>
      screen.queryByRole("dialog", { name: "Rename employee" });
    const openDialog = () =>
      fireEvent.click(screen.getByRole("button", { name: "Rename employee" }));

    // When the owner types a name and presses Escape
    openDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Other" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    // Then the dialog is gone
    expect(dialog()).toBeNull();

    // When the owner cancels with the button, then with the backdrop
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeNull();
    openDialog();
    fireEvent.click(screen.getByTestId("rename-backdrop"));
    expect(dialog()).toBeNull();

    // When the owner saves without changing the name
    openDialog();
    await act(async () => {
      fireEvent.submit(
        screen.getByLabelText("Name").closest("form") as HTMLFormElement,
      );
    });

    // Then the dialog closes and nothing was ever sent
    expect(dialog()).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with a one-line error when the server refuses the name, and closes once a retry is accepted", async () => {
    // Given a server that refuses the first save and takes the second
    const onRename = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    openWithWake(session({ ownerName: "Login fixer" }), { onRename });
    fireEvent.click(screen.getByRole("button", { name: "Rename employee" }));
    const input = screen.getByLabelText("Name");
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.change(input, { target: { value: "Bug squasher" } });

    // When the owner saves and is refused
    await act(async () => {
      fireEvent.submit(form);
    });

    // Then the dialog stays with the typed name and an alert line
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not rename. Try again.",
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Bug squasher",
    );

    // When the owner saves again and it is accepted
    await act(async () => {
      fireEvent.submit(form);
    });

    // Then the dialog closes
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("dialog", { name: "Rename employee" }),
    ).toBeNull();
  });

  it("titles the card with the owner's name over the desk name, and the folder's name when neither exists", () => {
    // Given three employees: named by the owner, by its desk, and by neither
    const titleOf = (extra: Partial<SessionDto>) => {
      const { unmount } = openWithWake(session(extra));
      const title = screen.getByRole("heading", { level: 2 }).textContent;
      unmount();
      return title;
    };

    // When each card opens
    // Then the owner's name wins, then the desk name, then the folder
    expect(titleOf({ deskName: "Fix bug", ownerName: "Login fixer" })).toBe(
      "Login fixer",
    );
    expect(titleOf({ deskName: "Fix bug" })).toBe("Fix bug");
    expect(titleOf({})).toBe("claude-office");
  });
});

describe("the original request", () => {
  afterEach(cleanup);

  it("has no info button when the session has no request", () => {
    open(session({ deskName: "Fix cart" }));
    expect(
      screen.queryByRole("button", { name: "Show the original request" }),
    ).toBeNull();
  });

  it("opens the full request in a popup from the info button and closes it with Escape, the close button or a click outside", () => {
    // Given a session with a multi-line request
    const request = "Check the latest message\n\non the real conversation";
    open(session({ deskName: "Check latest message", request }));
    const icon = screen.getByRole("button", {
      name: "Show the original request",
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // When the icon is clicked
    fireEvent.click(icon);

    // Then the popup shows the whole request
    const dialog = screen.getByRole("dialog", { name: "Original request" });
    expect(dialog.textContent).toContain(request);
    expect(icon.getAttribute("aria-expanded")).toBe("true");

    // And Escape, the close button and the backdrop each close it
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(icon);
    fireEvent.click(screen.getByRole("button", { name: "Close request" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(icon);
    fireEvent.click(screen.getByTestId("request-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the popup open when the text inside it is clicked", () => {
    open(session({ request: "Do the thing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Show the original request" }),
    );
    fireEvent.click(screen.getByText("Do the thing"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
