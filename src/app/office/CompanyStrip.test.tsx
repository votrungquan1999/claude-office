// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverview, type MacOverview } from "@/shared/overview";
import { CompanyStrip } from "./CompanyStrip";

const company = (
  name: string,
  counts: [number, number, number, number],
  options: { needsYou?: boolean; active?: boolean; machineId?: string } = {},
) => ({
  company: {
    key: `${options.machineId ?? "m1"}\0/${name}`,
    machineId: options.machineId ?? "m1",
    name,
    folderName: name,
    path: `/${name}`,
    other: false,
  },
  counts: {
    working: counts[0],
    needsPermission: counts[1],
    waitingForYou: counts[2],
    review: 0,
    idle: counts[3],
  },
  needsYou: options.needsYou ?? false,
  active: options.active ?? true,
});

describe("the company strip", () => {
  afterEach(cleanup);

  it("shows a tab per active company with four labelled counts, a badge only when the owner is needed on an online Mac, and greys an offline Mac", () => {
    // Given an online Mac with an urgent company, a quiet one with nothing live, and an offline Mac
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [
          company("personal", [3, 1, 1, 5], { needsYou: true }),
          company("old", [0, 0, 0, 0], { active: false }),
        ],
      },
      {
        machineId: "m2",
        machineName: "Mini",
        online: false,
        switchedOff: [],
        companies: [company("lab", [0, 2, 0, 0], { machineId: "m2" })],
      },
      {
        machineId: "m3",
        machineName: "Empty",
        online: true,
        switchedOff: [],
        companies: [],
      },
    ];

    // When the strip renders
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );

    // Then only active companies get tabs, and a Mac without tabs gets no label
    const tabs = screen.getAllByTestId("company-tab");
    expect(tabs.map((tab) => tab.getAttribute("data-company-name"))).toEqual([
      "personal",
      "lab",
    ]);
    expect(screen.queryByText("Empty")).toBeNull();

    // And each tab carries the four counts in room order
    const personal = within(tabs[0]);
    expect(
      ["3 working", "1 needs permission", "1 waiting for you", "5 idle"].map(
        (label) => personal.getByLabelText(label).textContent,
      ),
    ).toEqual(["3", "1", "1", "5"]);

    // And the urgent company shows a badge of how many need the owner
    expect(personal.getByTestId("company-badge").textContent).toBe("2");

    // And the offline Mac is greyed, keeps its counts and shows no badge
    const mini = screen.getByTestId("mac-group-m2");
    expect(mini.getAttribute("data-offline")).toBe("true");
    expect(within(mini).getByLabelText("2 needs permission")).toBeTruthy();
    expect(within(mini).queryByTestId("company-badge")).toBeNull();
    expect(
      screen.getByTestId("mac-group-m1").getAttribute("data-offline"),
    ).toBe("false");
    // And the greying is visible: the offline group is half opaque, the online one fully
    expect(mini.style.opacity).toBe("0.5");
    expect(screen.getByTestId("mac-group-m1").style.opacity).toBe("1");
  });

  it("keeps the All companies button outside the scrolling tabs, and shows it with no companies at all", () => {
    // Given a Mac with two companies
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("a", [1, 0, 0, 0]), company("b", [0, 0, 0, 1])],
      },
    ];

    // When the strip renders
    const { rerender } = render(
      <CompanyStrip
        macs={macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );

    // Then the tabs are in their own scroller and the button is not
    const scroller = screen.getByTestId("company-tabs");
    expect(within(scroller).getAllByTestId("company-tab")).toHaveLength(2);
    expect(within(scroller).queryByTestId("open-drawer")).toBeNull();
    expect(screen.getByTestId("company-strip").contains(scroller)).toBe(true);
    expect(
      screen
        .getByTestId("company-strip")
        .contains(screen.getByTestId("open-drawer")),
    ).toBe(true);

    // And with no companies the button still shows
    rerender(
      <CompanyStrip
        macs={[]}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );
    expect(screen.getByTestId("open-drawer")).toBeTruthy();
  });

  it("folds a Mac's group to one 'Air · 2 companies' label when its toggle is pressed, and opens it again", () => {
    // Given two Macs, the viewed company on the second, nothing folded
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("a", [1, 0, 0, 0]), company("b", [0, 0, 0, 1])],
      },
      {
        machineId: "m2",
        machineName: "Mini",
        online: true,
        switchedOff: [],
        companies: [company("lab", [1, 0, 0, 0], { machineId: "m2" })],
      },
    ];
    const toggles: string[] = [];
    const strip = (collapsed: string[]) => (
      <CompanyStrip
        macs={macs}
        selectedKey={macs[1].companies[0].company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set(collapsed)}
        onToggleMac={(id) => toggles.push(id)}
      />
    );
    const { rerender } = render(strip([]));

    // Then every tab shows and the Air toggle is open
    const toggle = screen.getByTestId("mac-toggle-m1");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByTestId("company-tab")).toHaveLength(3);

    // When the owner presses the Air toggle
    fireEvent.click(toggle);

    // Then the strip asks to fold Air
    expect(toggles).toEqual(["m1"]);

    // When Air is folded
    rerender(strip(["m1"]));

    // Then its two tabs are gone, the label counts them, and the other Mac is untouched
    expect(screen.getByTestId("mac-toggle-m1").textContent).toContain(
      "Air · 2 companies",
    );
    expect(
      screen.getByTestId("mac-toggle-m1").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .getAllByTestId("company-tab")
        .map((tab) => tab.getAttribute("data-company-name")),
    ).toEqual(["lab"]);

    // When the owner presses the label again
    fireEvent.click(screen.getByTestId("mac-toggle-m1"));

    // Then the strip asks to open Air
    expect(toggles).toEqual(["m1", "m1"]);
  });

  it("reads '· 1 company' on a folded Mac that hides exactly one company", () => {
    // Given a folded Mac with a single company, the viewed one on another Mac
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("a", [1, 0, 0, 0])],
      },
      {
        machineId: "m2",
        machineName: "Mini",
        online: true,
        switchedOff: [],
        companies: [company("lab", [1, 0, 0, 0], { machineId: "m2" })],
      },
    ];

    // When the strip renders with Air folded
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={macs[1].companies[0].company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set(["m1"])}
        onToggleMac={() => {}}
      />,
    );

    // Then the label is singular
    expect(screen.getByTestId("mac-toggle-m1").textContent).toContain(
      "Air · 1 company",
    );
    expect(screen.getByTestId("mac-toggle-m1").textContent).not.toContain(
      "companies",
    );
  });

  it("keeps the viewed company's tab on a folded Mac and badges what the hidden companies need from the owner", () => {
    // Given a folded Mac with the viewed company and two hidden ones, one urgent and one quiet
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [
          company("here", [0, 1, 1, 0], { needsYou: true }),
          company("urgent", [0, 2, 1, 0], { needsYou: true }),
          company("quiet", [3, 0, 0, 0]),
        ],
      },
    ];

    // When the strip renders with Air folded
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={macs[0].companies[0].company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set(["m1"])}
        onToggleMac={() => {}}
      />,
    );

    // Then only the viewed tab shows, the label counts the two hidden ones, and the badge sums their needs-you counts
    expect(
      screen
        .getAllByTestId("company-tab")
        .map((tab) => tab.getAttribute("data-company-name")),
    ).toEqual(["here"]);
    expect(screen.getByTestId("mac-toggle-m1").textContent).toContain(
      "Air · 2 companies",
    );
    expect(screen.getByTestId("mac-badge-m1").textContent).toBe("3");
  });

  it("shows only the caret and the Mac's name on a folded Mac whose one tab is the viewed one", () => {
    // Given a folded Mac with a single company, which is the viewed one
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("here", [1, 0, 0, 0])],
      },
    ];

    // When the strip renders with Air folded
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={macs[0].companies[0].company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set(["m1"])}
        onToggleMac={() => {}}
      />,
    );

    // Then nothing is hidden, so the label has no company count and there is no badge
    expect(screen.getByTestId("mac-toggle-m1").textContent).toBe("▶Air");
    expect(screen.queryByTestId("mac-badge-m1")).toBeNull();
  });

  it("shows no tab on a folded Mac viewed elsewhere, badges all its needs-you counts, and gives an offline folded Mac no badge", () => {
    // Given a folded online Mac with two urgent companies, a folded offline Mac, and the viewed company on a third Mac
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [
          company("a", [0, 1, 0, 0], { needsYou: true }),
          company("b", [0, 0, 2, 0], { needsYou: true }),
        ],
      },
      {
        machineId: "m2",
        machineName: "Mini",
        online: false,
        switchedOff: [],
        companies: [company("lab", [0, 4, 0, 0], { machineId: "m2" })],
      },
      {
        machineId: "m3",
        machineName: "Pro",
        online: true,
        switchedOff: [],
        companies: [company("here", [1, 0, 0, 0], { machineId: "m3" })],
      },
    ];

    // When the strip renders with Air and Mini folded
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={macs[2].companies[0].company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set(["m1", "m2"])}
        onToggleMac={() => {}}
      />,
    );

    // Then only the viewed tab shows, Air badges 3, and Mini has no badge
    expect(
      screen
        .getAllByTestId("company-tab")
        .map((tab) => tab.getAttribute("data-company-name")),
    ).toEqual(["here"]);
    expect(screen.getByTestId("mac-badge-m1").textContent).toBe("3");
    expect(screen.queryByTestId("mac-badge-m2")).toBeNull();
  });

  it("carries a company's full name as the tab's hover text so a long name can be cut short", () => {
    // Given a company with a long name
    const long = "a-very-long-company-name-that-needs-cutting";
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company(long, [1, 0, 0, 0])],
      },
    ];

    // When the strip renders
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );

    // Then the tab's hover text is the full name
    expect(screen.getByTestId("company-tab").getAttribute("title")).toBe(long);
  });

  it("includes the viewed company's tab even when nothing is live in it, and renders an empty strip without a crash", () => {
    // Given a company with nothing live that is the viewed one
    const quiet = company("quiet", [0, 0, 0, 0], { active: false });
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [quiet],
      },
    ];

    // When it is selected
    const { rerender } = render(
      <CompanyStrip
        macs={macs}
        selectedKey={quiet.company.key}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );

    // Then its tab shows
    expect(screen.getAllByTestId("company-tab")).toHaveLength(1);

    // And with no Macs at all the strip is empty
    rerender(
      <CompanyStrip
        macs={[]}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );
    expect(screen.queryAllByTestId("company-tab")).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Companies" })).toBeTruthy();
  });

  it("shows Other as the last tab of its Mac with its four counts, from sessions started in a switched-off folder", () => {
    // Given g is off, with a company below it and two sessions started at g itself
    const T = "2026-11-09T10:00:00.000Z";
    const session = (id: string, cwd: string, state: "working" | "idle") => ({
      machineId: "m1",
      machineName: "Air",
      sessionId: id,
      cwd,
      startCwd: cwd,
      state,
      startedAt: T,
      changedAt: T,
    });
    const overview = buildOverview({
      folders: [{ machineId: "m1", path: "/g", companyMode: false }],
      sessions: [
        session("a", "/g/a", "idle"),
        session("x", "/g", "working"),
        session("y", "/g", "idle"),
      ],
      machines: [{ machineId: "m1", machineName: "Air", lastSeenAt: T }],
      offlineMachineIds: new Set(),
      departures: [],
    });

    // When the strip renders
    render(
      <CompanyStrip
        macs={overview.macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
      />,
    );

    // Then Other comes after a, with the counts of the two sessions
    const tabs = screen.getAllByTestId("company-tab");
    expect(tabs.map((tab) => tab.dataset.companyName)).toEqual(["a", "Other"]);
    const other = within(tabs[1] as HTMLElement);
    expect(other.getByLabelText("1 working")).toBeTruthy();
    expect(other.getByLabelText("1 idle")).toBeTruthy();
  });
});

describe("renaming a company from its tab", () => {
  afterEach(cleanup);

  /** One Mac with a renamed company (Harbor, folder q), an unnamed one (p) and Other. */
  const macsOf = (): MacOverview[] => {
    const named = company("q", [1, 0, 0, 0]);
    named.company.name = "Harbor";
    return [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [
          named,
          company("p", [0, 0, 0, 1]),
          {
            ...company("Other", [0, 0, 0, 1]),
            company: {
              ...company("Other", [0, 0, 0, 1]).company,
              path: null,
              other: true,
            },
          },
        ],
      },
    ];
  };
  const renderStrip = (
    onRename: (m: string, p: string, n: string | null) => void,
    renamable = true,
  ) =>
    render(
      <CompanyStrip
        macs={macsOf()}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
        onRename={onRename}
        renamable={renamable}
      />,
    );
  const tabNamed = (name: string) =>
    screen
      .getAllByTestId("company-tab")
      .find(
        (tab) => tab.getAttribute("data-company-name") === name,
      ) as HTMLElement;

  it("opens a name field filled with the company's name when its tab is double-clicked", () => {
    // Given a strip with a renamed company
    renderStrip(vi.fn());

    // When the owner double-clicks its tab
    fireEvent.doubleClick(tabNamed("Harbor"));

    // Then a name field holds the current name
    const field = screen.getByLabelText(
      "Name for folder q",
    ) as HTMLInputElement;
    expect(field.value).toBe("Harbor");
  });

  it("drops an open field when its company disappears, and does not bring it back when the company returns", () => {
    // Given an open name field on Harbor
    const strip = (macs: MacOverview[]) => (
      <CompanyStrip
        macs={macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
        onRename={() => {}}
        renamable
      />
    );
    const { rerender } = render(strip(macsOf()));
    fireEvent.doubleClick(tabNamed("Harbor"));
    expect(screen.getByLabelText("Name for folder q")).toBeTruthy();

    // When Harbor leaves the strip and then comes back
    const without = macsOf().map((mac) => ({
      ...mac,
      companies: mac.companies.filter((entry) => entry.company.path !== "/q"),
    }));
    rerender(strip(without));
    rerender(strip(macsOf()));

    // Then no name field is open
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
  });

  it("saves the typed name once on Enter and closes the field", () => {
    // Given an open name field
    const onRename = vi.fn();
    renderStrip(onRename);
    fireEvent.doubleClick(tabNamed("Harbor"));
    const field = screen.getByLabelText("Name for folder q");

    // When the owner types a name and presses Enter
    fireEvent.change(field, { target: { value: "  Dock  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);

    // Then one rename is sent with the trimmed name and the field is gone
    expect(onRename.mock.calls).toEqual([["m1", "/q", "Dock"]]);
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
  });

  it("sends nothing when Escape cancels the field, even though the field then loses focus", () => {
    // Given an open name field with typed text
    const onRename = vi.fn();
    renderStrip(onRename);
    fireEvent.doubleClick(tabNamed("Harbor"));
    const field = screen.getByLabelText("Name for folder q");
    fireEvent.change(field, { target: { value: "Dropped" } });

    // When the owner presses Escape
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);

    // Then nothing is sent and the field is gone
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name for folder q")).toBeNull();
  });

  it("saves once when the owner clicks away from the field", () => {
    // Given an open name field with typed text
    const onRename = vi.fn();
    renderStrip(onRename);
    fireEvent.doubleClick(tabNamed("Harbor"));
    const field = screen.getByLabelText("Name for folder q");
    fireEvent.change(field, { target: { value: "Dock" } });

    // When focus leaves the field
    fireEvent.blur(field);

    // Then the name is saved once
    expect(onRename.mock.calls).toEqual([["m1", "/q", "Dock"]]);
  });

  it("uses the drawer's reset rule: blank or the folder's own name sends null, an unchanged name and a blank on an unnamed company send nothing", () => {
    // Given a strip with a renamed company (Harbor, folder q) and an unnamed one (p)
    const onRename = vi.fn();
    renderStrip(onRename);
    const save = (tab: string, value: string) => {
      fireEvent.doubleClick(tabNamed(tab));
      const field = screen.getByLabelText(/^Name for folder /);
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key: "Enter" });
    };

    // When the owner saves a blank, the folder's own name, and the unchanged name on the renamed company
    save("Harbor", "   ");
    save("Harbor", "q");
    save("Harbor", "Harbor");

    // Then only the first two ask to put the folder name back
    expect(onRename.mock.calls).toEqual([
      ["m1", "/q", null],
      ["m1", "/q", null],
    ]);

    // When the owner saves a blank or the folder's own name on the unnamed company
    onRename.mockClear();
    save("p", "");
    save("p", "p");

    // Then nothing is sent
    expect(onRename).not.toHaveBeenCalled();
  });

  it("never opens a field on Other, or when the strip is not renamable", () => {
    // Given a renamable strip
    const first = renderStrip(vi.fn());

    // When the owner double-clicks Other
    fireEvent.doubleClick(tabNamed("Other"));

    // Then no field opens
    expect(screen.queryByRole("textbox")).toBeNull();
    first.unmount();

    // And a strip that is not renamable opens none either
    renderStrip(vi.fn(), false);
    fireEvent.doubleClick(tabNamed("Harbor"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("picks another tab on press while a field is open, so the save's re-sort cannot swallow the click", () => {
    // Given an open name field and a spy on picks
    const picked: string[] = [];
    render(
      <CompanyStrip
        macs={macsOf()}
        selectedKey={null}
        onSelect={(key) => picked.push(key)}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
        onRename={() => {}}
        renamable
      />,
    );
    fireEvent.doubleClick(tabNamed("Harbor"));
    picked.length = 0;

    // When the owner presses another tab
    fireEvent.pointerDown(tabNamed("p"));

    // Then that tab is picked at once
    expect(picked).toEqual(["m1\0/p"]);
  });

  it("on a phone a tab shows the name and the needs-you badge only, no counts", () => {
    // Given a company with four counts that needs the owner
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("personal", [3, 1, 2, 5], { needsYou: true })],
      },
    ];

    // When the strip renders for a phone
    render(
      <CompanyStrip
        macs={macs}
        selectedKey={null}
        onSelect={() => {}}
        onOpenDrawer={() => {}}
        collapsedMacs={new Set()}
        onToggleMac={() => {}}
        phone
      />,
    );

    // Then the tab holds the name and a badge of 3, with no labelled counts
    const tab = screen.getByTestId("company-tab");
    expect(tab.textContent).toBe("personal3");
    expect(within(tab).queryAllByRole("img")).toHaveLength(0);
  });

  it("on a phone the Mac fold toggle is at least 44 px tall, and on desktop it keeps its 40 px", () => {
    // Given a Mac with one company
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [company("personal", [1, 0, 0, 0])],
      },
    ];
    const props = {
      macs,
      selectedKey: null,
      onSelect: () => {},
      onOpenDrawer: () => {},
      collapsedMacs: new Set<string>(),
      onToggleMac: () => {},
    };

    // When the strip renders for a phone
    const { unmount } = render(<CompanyStrip {...props} phone />);

    // Then the toggle's height floor is 44 px
    expect(screen.getByTestId("mac-toggle-m1").className).toContain(
      "min-h-[44px]",
    );
    unmount();

    // And on desktop it stays 40 px
    render(<CompanyStrip {...props} />);
    expect(screen.getByTestId("mac-toggle-m1").className).toContain("h-40");
  });

  it("on a phone All companies is an icon button named All companies with no visible text, and on desktop it keeps its text", () => {
    // Given a phone strip and a desktop strip
    const props = {
      macs: [],
      selectedKey: null,
      onSelect: () => {},
      onOpenDrawer: () => {},
      collapsedMacs: new Set<string>(),
      onToggleMac: () => {},
    };
    const { unmount } = render(<CompanyStrip {...props} phone />);

    // Then the phone button is named by label, shows an icon and no text, and still announces a dialog
    const icon = screen.getByRole("button", { name: "All companies" });
    expect(icon.getAttribute("aria-haspopup")).toBe("dialog");
    expect(icon.getAttribute("data-testid")).toBe("open-drawer");
    expect(icon.textContent).toBe("");
    expect(icon.querySelector("svg")).not.toBeNull();
    unmount();

    // And on desktop the button reads All companies as text with no icon
    render(<CompanyStrip {...props} />);
    const text = screen.getByRole("button", { name: "All companies" });
    expect(text.textContent).toBe("All companies");
    expect(text.querySelector("svg")).toBeNull();
  });
});
