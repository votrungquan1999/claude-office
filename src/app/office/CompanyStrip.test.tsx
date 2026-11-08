// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildOverview, type MacOverview } from "@/shared/overview";
import { CompactCompanyButton, CompanyStrip } from "./CompanyStrip";

const company = (
  name: string,
  counts: [number, number, number, number],
  options: { needsYou?: boolean; active?: boolean; machineId?: string } = {},
) => ({
  company: {
    key: `${options.machineId ?? "m1"}\0/${name}`,
    machineId: options.machineId ?? "m1",
    name,
    path: `/${name}`,
    other: false,
  },
  counts: {
    working: counts[0],
    needsPermission: counts[1],
    waitingForYou: counts[2],
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

describe("the compact company button", () => {
  afterEach(cleanup);

  it("names the viewed company and badges what needs the owner on online Macs, once", () => {
    // Given the viewed company is calm, another online one needs the owner, and an offline Mac's does not count
    const calm = company("calm", [1, 0, 0, 0]);
    const macs: MacOverview[] = [
      {
        machineId: "m1",
        machineName: "Air",
        online: true,
        switchedOff: [],
        companies: [calm, company("urgent", [0, 2, 1, 0], { needsYou: true })],
      },
      {
        machineId: "m2",
        machineName: "Mini",
        online: false,
        switchedOff: [],
        companies: [company("lab", [0, 4, 0, 0], { machineId: "m2" })],
      },
    ];
    const opened: string[] = [];

    // When it renders and is pressed
    render(
      <CompactCompanyButton
        macs={macs}
        selectedKey={calm.company.key}
        onOpenDrawer={() => opened.push("open")}
      />,
    );
    const button = screen.getByTestId("compact-company-button");
    fireEvent.click(button);

    // Then it shows the viewed company and a badge of 3, and asked to open once
    expect(button.textContent).toBe("calm3");
    expect(within(button).getByTestId("company-badge").textContent).toBe("3");
    expect(opened).toEqual(["open"]);
  });
});
