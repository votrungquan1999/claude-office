// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverview } from "@/shared/overview";
import type { SessionDto } from "@/shared/session";
import { CompanyDrawer } from "./CompanyDrawer";

const T = "2026-11-09T10:00:00.000Z";
const live = (
  machineId: string,
  sessionId: string,
  cwd: string,
  state: SessionDto["state"],
): SessionDto => ({
  machineId,
  machineName: machineId,
  sessionId,
  cwd,
  startCwd: cwd,
  state,
  startedAt: T,
  changedAt: T,
});

/** Two Macs named alike (the second offline), a company with nothing live, and an online Mac with no companies. */
function fixture() {
  const sessions = [
    live("m1", "a", "/p/x", "working"),
    live("m1", "b", "/p/x", "thinking"),
    live("m1", "c", "/p/x", "idle"),
    live("m1", "d", "/q/y", "needsPermission"),
    live("m1", "e", "/q/y", "waitingForYou"),
    live("m2", "f", "/p/x", "needsPermission"),
  ];
  const folders = [
    { machineId: "m1", path: "/p", companyMode: true },
    { machineId: "m1", path: "/q", companyMode: true },
    { machineId: "m1", path: "/empty", companyMode: true },
    { machineId: "m2", path: "/p", companyMode: true },
  ];
  return buildOverview({
    folders,
    sessions,
    machines: [
      { machineId: "m1", machineName: "Studio", lastSeenAt: T },
      { machineId: "m2", machineName: "Studio", lastSeenAt: T },
      { machineId: "m3", machineName: "Bare", lastSeenAt: T },
    ],
    offlineMachineIds: new Set(["m2"]),
    departures: [],
  });
}

describe("the company drawer", () => {
  afterEach(cleanup);

  it("lists every Mac and company with four counts including zeros, greys the offline Mac, says when a Mac has no companies, and counts what needs the owner elsewhere", () => {
    // Given the viewed company is p on the first Studio
    const overview = fixture();
    const viewed = overview.macs[0].companies.find(
      (entry) => entry.company.name === "p",
    )?.company.key;

    // When the drawer renders
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={viewed ?? null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
      />,
    );

    // Then it is a named dialog with both same-named Macs, and the empty one says so
    const dialog = screen.getByRole("dialog", { name: "All companies" });
    expect(within(dialog).getAllByText(/^Studio/)).toHaveLength(2);
    expect(
      within(screen.getByTestId("drawer-mac-m3")).getByText("No companies yet"),
    ).toBeTruthy();

    // And a company with nothing live is listed with zero counts
    const empty = within(screen.getByTestId("drawer-company-empty"));
    expect(
      ["0 working", "0 needs permission", "0 waiting for you", "0 idle"].map(
        (label) => empty.getByLabelText(label).textContent,
      ),
    ).toEqual(["0", "0", "0", "0"]);

    // And a company folds Thinking into Working
    const p = within(screen.getByTestId("drawer-mac-m1")).getByTestId(
      "drawer-company-p",
    );
    expect(within(p).getByLabelText("2 working")).toBeTruthy();

    // And the offline Mac is greyed but keeps its four counts
    const offline = screen.getByTestId("drawer-mac-m2");
    expect(offline.getAttribute("data-offline")).toBe("true");
    expect(within(offline).getByLabelText("1 needs permission")).toBeTruthy();
    // And the greying is visible: the offline Mac is half opaque, the online one fully
    expect(offline.style.opacity).toBe("0.5");
    expect(screen.getByTestId("drawer-mac-m1").style.opacity).toBe("1");

    // And the header counts what needs the owner in other companies on online Macs only
    expect(screen.getByTestId("elsewhere-need-you").textContent).toBe(
      "2 elsewhere need you",
    );
  });

  it("picks a company when its row is pressed, and closes on Escape or the close button", () => {
    // Given an open drawer
    const overview = fixture();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet
        onSelect={onSelect}
        onClose={onClose}
        onSetCompanyMode={() => {}}
      />,
    );

    // When the owner presses the q company
    fireEvent.click(
      within(screen.getByTestId("drawer-company-q")).getByRole("button", {
        name: /q/,
      }),
    );

    // Then that company's key is picked
    expect(onSelect).toHaveBeenCalledWith("m1\0/q");

    // When the owner presses Escape and then the close button
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Then it asks to close both times
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape pressed anywhere in the page, and stops listening once unmounted", () => {
    // Given an open drawer with focus outside it
    const onClose = vi.fn();
    const { unmount } = render(
      <CompanyDrawer
        overview={fixture()}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={onClose}
        onSetCompanyMode={() => {}}
      />,
    );

    // When Escape is pressed on the page body
    fireEvent.keyDown(document.body, { key: "Escape" });

    // Then it asks to close
    expect(onClose).toHaveBeenCalledTimes(1);

    // And after unmounting Escape no longer reaches it
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the elsewhere header when nothing outside the viewed company needs the owner", () => {
    // Given the only online company needing the owner is the viewed one
    const overview = buildOverview({
      folders: [{ machineId: "m1", path: "/q", companyMode: true }],
      sessions: [live("m1", "d", "/q/y", "needsPermission")],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });

    // When the drawer renders with that company selected
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={"m1\0/q"}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
      />,
    );

    // Then the header is absent
    expect(screen.queryByTestId("elsewhere-need-you")).toBeNull();
  });

  it("puts a switch on each company, lists a switched-off folder as a dimmed row in Other with its switch, and gives Other none", () => {
    // Given g is switched off: its children a and b are companies, and a session started at g itself sits in Other
    const overview = buildOverview({
      folders: [{ machineId: "m1", path: "/g", companyMode: false }],
      sessions: [
        live("m1", "x", "/g/a", "working"),
        live("m1", "y", "/g/b", "idle"),
        live("m1", "z", "/g", "idle"),
      ],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    const onSetCompanyMode = vi.fn();
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={onSetCompanyMode}
      />,
    );

    // Then each company row has a switch that is on
    const a = within(screen.getByTestId("drawer-company-a"));
    expect(a.getByRole("switch").getAttribute("aria-checked")).toBe("true");

    // And the switched-off folder is a dimmed row reading "in Other" with its switch off
    const g = screen.getByTestId("drawer-off-g");
    expect(within(g).getByText("in Other")).toBeTruthy();
    expect(g.getAttribute("data-dimmed")).toBe("true");
    expect(within(g).getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );

    // And Other has no switch
    expect(
      within(screen.getByTestId("drawer-company-Other")).queryByRole("switch"),
    ).toBeNull();

    // When the owner presses a's switch and g's switch
    fireEvent.click(a.getByRole("switch"));
    fireEvent.click(within(g).getByRole("switch"));

    // Then each press asks exactly once for the opposite value
    expect(onSetCompanyMode.mock.calls).toEqual([
      ["m1", "/g/a", false],
      ["m1", "/g", true],
    ]);
  });
});
