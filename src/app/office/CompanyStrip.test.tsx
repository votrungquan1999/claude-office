// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MacOverview } from "@/shared/overview";
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
});
