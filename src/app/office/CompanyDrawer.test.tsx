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
        name: /^q/,
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

    // And Other has no switch and counts the session started at g itself as idle
    const other = within(screen.getByTestId("drawer-company-Other"));
    expect(other.queryByRole("switch")).toBeNull();
    expect(other.getByLabelText("1 idle")).toBeTruthy();

    // When the owner presses a's switch and g's switch
    fireEvent.click(a.getByRole("switch"));
    fireEvent.click(within(g).getByRole("switch"));

    // Then each press asks exactly once for the opposite value
    expect(onSetCompanyMode.mock.calls).toEqual([
      ["m1", "/g/a", false],
      ["m1", "/g", true],
    ]);
  });

  it("shows the folder name under a renamed company only, not under an unnamed one or Other", () => {
    // Given q is renamed to Harbor and p is not
    const overview = buildOverview({
      folders: [
        { machineId: "m1", path: "/p", companyMode: true },
        {
          machineId: "m1",
          path: "/q",
          companyMode: true,
          displayName: "Harbor",
        },
        { machineId: "m1", path: "/g", companyMode: false },
      ],
      sessions: [
        live("m1", "a", "/p/x", "working"),
        live("m1", "d", "/q/y", "working"),
        live("m1", "z", "/g", "working"),
      ],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });

    // When the drawer renders
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
      />,
    );

    // Then only the renamed row names its folder
    expect(
      within(screen.getByTestId("drawer-company-Harbor")).getByText("folder q"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("drawer-company-p")).queryByText(/^folder /),
    ).toBeNull();
    expect(
      within(screen.getByTestId("drawer-company-Other")).queryByText(
        /^folder /,
      ),
    ).toBeNull();
  });

  it("tells two companies with the same shown name apart by folder, and hides the line while that row is edited", () => {
    // Given two api folders both named Shared
    const overview = buildOverview({
      folders: [
        {
          machineId: "m1",
          path: "/a/api",
          companyMode: true,
          displayName: "Shared",
        },
        {
          machineId: "m1",
          path: "/b/api",
          companyMode: true,
          displayName: "Shared",
        },
      ],
      sessions: [],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
        onRename={() => {}}
      />,
    );

    // Then each row names its own folder with the parent
    expect(screen.getByText("folder a/api")).toBeTruthy();
    expect(screen.getByText("folder b/api")).toBeTruthy();

    // When the first row's editor opens
    fireEvent.click(
      screen.getAllByRole("button", { name: "Rename Shared" })[0],
    );

    // Then the editor names its folder, and exactly one folder line is gone
    expect(screen.getAllByText(/^folder [ab]\/api$/)).toHaveLength(1);
  });

  it("shows the folder name on a dimmed switched-off row that has a custom name, and not on one without", () => {
    // Given /g is switched off and named Archive, and /h is switched off without a name
    const overview = buildOverview({
      folders: [
        {
          machineId: "m1",
          path: "/g",
          companyMode: false,
          displayName: "Archive",
        },
        { machineId: "m1", path: "/h", companyMode: false },
      ],
      sessions: [],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });

    // When the drawer renders
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
      />,
    );

    // Then only the named row names its folder
    expect(
      within(screen.getByTestId("drawer-off-Archive")).getByText("folder g"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("drawer-off-h")).queryByText(/^folder /),
    ).toBeNull();
  });

  describe("putting the folder name back", () => {
    /** One renamed company (q shown as Harbor) and one never renamed (p). */
    function renamedOverview() {
      return buildOverview({
        folders: [
          { machineId: "m1", path: "/p", companyMode: true },
          {
            machineId: "m1",
            path: "/q",
            companyMode: true,
            displayName: "Harbor",
          },
        ],
        sessions: [],
        machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
        offlineMachineIds: new Set(),
        departures: [],
      });
    }
    const renderDrawer = (onRename: () => void) =>
      render(
        <CompanyDrawer
          overview={renamedOverview()}
          selectedKey={null}
          sheet={false}
          onSelect={() => {}}
          onClose={() => {}}
          onSetCompanyMode={() => {}}
          onRename={onRename}
        />,
      );

    it("asks once for the folder name back from Use folder name, closes the editor and returns focus to the pencil", () => {
      // Given a renamed company with its editor open
      const onRename = vi.fn();
      renderDrawer(onRename);
      fireEvent.click(screen.getByRole("button", { name: "Rename Harbor" }));

      // When the owner presses Use folder name
      fireEvent.click(screen.getByRole("button", { name: "Use folder name" }));

      // Then the drawer asks once to clear the name, and the editor is closed with focus on the pencil
      expect(onRename.mock.calls).toEqual([["m1", "/q", null]]);
      expect(screen.queryByLabelText("Name for folder q")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Rename Harbor" }),
      );
    });

    it("sends null when the saved text is the folder's own name", () => {
      // Given a renamed company with its editor open
      const onRename = vi.fn();
      renderDrawer(onRename);
      fireEvent.click(screen.getByRole("button", { name: "Rename Harbor" }));

      // When the owner types the folder's own name and saves
      fireEvent.change(screen.getByLabelText("Name for folder q"), {
        target: { value: "q" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then the drawer asks to clear the name rather than store the folder name
      expect(onRename.mock.calls).toEqual([["m1", "/q", null]]);
    });

    it("sends null when a renamed company is saved with a blank name", () => {
      // Given a renamed company with its editor open
      const onRename = vi.fn();
      renderDrawer(onRename);
      fireEvent.click(screen.getByRole("button", { name: "Rename Harbor" }));

      // When the owner clears the field and saves
      fireEvent.change(screen.getByLabelText("Name for folder q"), {
        target: { value: "  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then the drawer asks to clear the name
      expect(onRename.mock.calls).toEqual([["m1", "/q", null]]);
    });

    it("offers no Use folder name and sends nothing when saving the folder name of a company that was never renamed", () => {
      // Given a never-renamed company with its editor open
      const onRename = vi.fn();
      renderDrawer(onRename);
      fireEvent.click(screen.getByRole("button", { name: "Rename p" }));

      // Then there is nothing to put back
      expect(
        screen.queryByRole("button", { name: "Use folder name" }),
      ).toBeNull();

      // When the owner saves the unchanged folder name
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      // Then no request is made
      expect(onRename).not.toHaveBeenCalled();
    });
  });

  it("opens a Name field filled with the company's name from its pencil, and Save asks once to rename it", () => {
    // Given an open drawer
    const onRename = vi.fn();
    const onSelect = vi.fn();
    render(
      <CompanyDrawer
        overview={fixture()}
        selectedKey={null}
        sheet={false}
        onSelect={onSelect}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
        onRename={onRename}
      />,
    );

    // When the owner presses q's pencil
    fireEvent.click(screen.getByRole("button", { name: "Rename q" }));

    // Then the field names the folder and starts with the current name
    const field = screen.getByLabelText(
      "Name for folder q",
    ) as HTMLInputElement;
    expect(field.value).toBe("q");

    // When the owner types a name and presses Save
    fireEvent.change(field, { target: { value: "  Harbor  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then the drawer asks once for the trimmed name, the editor is gone, and the row was not picked
    expect(onRename.mock.calls).toEqual([["m1", "/q", "Harbor"]]);
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("sends nothing for an unchanged name, a Cancel or a blank name on a company never renamed, and returns focus to the pencil", () => {
    // Given an open drawer
    const onRename = vi.fn();
    render(
      <CompanyDrawer
        overview={fixture()}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
        onRename={onRename}
      />,
    );
    const pencil = screen.getByRole("button", { name: "Rename q" });

    // When the owner saves the name untouched
    fireEvent.click(pencil);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then nothing is sent, the editor closes and the pencil has focus
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
    expect(document.activeElement).toBe(pencil);

    // When the owner types a name and cancels
    fireEvent.click(pencil);
    fireEvent.change(screen.getByLabelText("Name for folder q"), {
      target: { value: "Dropped" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Then nothing is sent and the pencil has focus
    expect(onRename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pencil);

    // When the owner clears the field and saves
    fireEvent.click(pencil);
    fireEvent.change(screen.getByLabelText("Name for folder q"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then nothing is sent, since there is no name to clear
    expect(onRename).not.toHaveBeenCalled();
  });

  it("cancels only the editor on Escape in the field, keeps one editor open at a time, and puts no pencil on Other or a switched-off row", () => {
    // Given a drawer with two Macs' companies, an Other row and a switched-off folder
    const overview = buildOverview({
      folders: [
        { machineId: "m1", path: "/g", companyMode: false },
        { machineId: "m1", path: "/q", companyMode: true },
      ],
      sessions: [
        live("m1", "x", "/g/a", "working"),
        live("m1", "z", "/g", "idle"),
        live("m1", "w", "/q", "idle"),
      ],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    const onClose = vi.fn();
    const onRename = vi.fn();
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={onClose}
        onSetCompanyMode={() => {}}
        onRename={onRename}
      />,
    );

    // Then only the two real companies have a pencil
    expect(
      screen
        .getAllByRole("button", { name: /^Rename / })
        .map((b) => b.ariaLabel),
    ).toEqual(["Rename a", "Rename q"]);

    // When the owner types in a's editor, then opens q's
    fireEvent.click(screen.getByRole("button", { name: "Rename a" }));
    fireEvent.change(screen.getByLabelText("Name for folder a"), {
      target: { value: "Lost" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename q" }));

    // Then a's editor is gone with its text and q's is open
    expect(screen.queryByLabelText("Name for folder a")).toBeNull();
    expect(
      (screen.getByLabelText("Name for folder q") as HTMLInputElement).value,
    ).toBe("q");

    // When the owner presses Escape in the field
    fireEvent.keyDown(screen.getByLabelText("Name for folder q"), {
      key: "Escape",
    });

    // Then only the editor closes
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("cancels only the editor on Escape pressed on Save, Cancel or Use folder name, and the drawer stays", () => {
    // Given a renamed company, so the editor has all three buttons
    const overview = buildOverview({
      folders: [
        {
          machineId: "m1",
          path: "/q",
          companyMode: true,
          displayName: "Harbor",
        },
      ],
      sessions: [live("m1", "w", "/q", "idle")],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    const onClose = vi.fn();
    const onRename = vi.fn();
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={onClose}
        onSetCompanyMode={() => {}}
        onRename={onRename}
      />,
    );

    for (const name of ["Save", "Cancel", "Use folder name"]) {
      // When the editor is open and Escape is pressed on that button
      fireEvent.click(screen.getByRole("button", { name: "Rename Harbor" }));
      fireEvent.keyDown(screen.getByRole("button", { name }), {
        key: "Escape",
      });

      // Then only the editor closes, and nothing was saved
      expect(screen.queryByLabelText("Name for folder q")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
    }

    // And with no editor open, Escape closes the drawer
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a long company name and its folder line in full, wrapped instead of cut short", () => {
    // Given a company named with 100 characters, and a switched-off folder named the same way
    const long = "N".repeat(100);
    const overview = buildOverview({
      folders: [
        { machineId: "m1", path: "/q", companyMode: true, displayName: long },
        { machineId: "m1", path: "/h", companyMode: false, displayName: long },
      ],
      sessions: [live("m1", "w", "/q", "idle")],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });

    // When the drawer renders
    render(
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
      />,
    );

    // Then every line of both rows wraps and none is clipped with an ellipsis
    for (const row of [
      screen.getByTestId(`drawer-company-${long}`),
      screen.getByTestId(`drawer-off-${long}`),
    ]) {
      const lines = within(row).getAllByText(
        (text) => text === long || text === "folder q" || text === "folder h",
      );
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.className).toContain("break-words");
        expect(line.className).not.toContain("truncate");
      }
    }
  });

  it("drops an open editor when its company disappears, and does not bring the draft back when the company returns", () => {
    // Given a drawer with q's editor open and a draft typed
    const withQ = buildOverview({
      folders: [{ machineId: "m1", path: "/q", companyMode: true }],
      sessions: [live("m1", "w", "/q", "idle")],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    const without = buildOverview({
      folders: [],
      sessions: [],
      machines: [{ machineId: "m1", machineName: "Studio", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });
    const drawer = (overview: typeof withQ) => (
      <CompanyDrawer
        overview={overview}
        selectedKey={null}
        sheet={false}
        onSelect={() => {}}
        onClose={() => {}}
        onSetCompanyMode={() => {}}
        onRename={() => {}}
      />
    );
    const { rerender } = render(drawer(withQ));
    fireEvent.click(screen.getByRole("button", { name: "Rename q" }));
    fireEvent.change(screen.getByLabelText("Name for folder q"), {
      target: { value: "Stale" },
    });

    // When q disappears and then comes back
    rerender(drawer(without));
    rerender(drawer(withQ));

    // Then no editor is open for it
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
  });
});
