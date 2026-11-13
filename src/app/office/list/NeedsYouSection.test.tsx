// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { selectNeedsYou } from "@/shared/needs-you";
import type { SessionDto } from "@/shared/session";
import { NeedsYouSection } from "./NeedsYouSection";

function session(sessionId: string, extra: Partial<SessionDto> = {}) {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/x",
    state: "waitingForYou",
    startedAt: "2026-11-01T00:00:00.000Z",
    stateSince: new Date().toISOString(),
    changedAt: new Date().toISOString(),
    deskName: `Task ${sessionId}`,
    ...extra,
  } satisfies SessionDto;
}

function needsYouOf(rows: SessionDto[]) {
  return selectNeedsYou({
    sessions: rows,
    companyOf: (s) => ({
      companyKey: s.machineId,
      companyName: `Company ${s.machineId}`,
    }),
    viewedCompany: "m1",
    companyOrder: ["m1", "m2"],
    offlineMachineIds: new Set(),
    includeOtherCompanies: true,
  });
}

function show(
  rows: SessionDto[],
  { onSelect = () => {}, selectedKey = null as string | null } = {},
) {
  render(
    <NeedsYouSection
      needsYou={needsYouOf(rows)}
      viewedCompanyKey="m1"
      selectedKey={selectedKey}
      serverOffsetMs={0}
      onSelect={onSelect}
      onMoveToIdle={() => {}}
      onMoveAllToIdle={() => {}}
      open={true}
      onToggle={() => {}}
    />,
  );
}

describe("the Needs you section", () => {
  afterEach(cleanup);

  it("shows four rows of the viewed company then 'and N more' that expands in place, with the total across companies in the header", () => {
    // Given seven needing employees here and one in another company
    show([
      ...["a", "b", "c", "d", "e", "f", "g"].map((id) => session(id)),
      session("z", { machineId: "m2" }),
    ]);

    // Then the header counts all eight; four own rows and the other company's one show, with "and 3 more"
    expect(screen.getByTestId("needs-count").textContent).toBe("8");
    expect(screen.getAllByTestId("needs-row")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "and 3 more" })).toBeTruthy();

    // When the owner expands it
    fireEvent.click(screen.getByRole("button", { name: "and 3 more" }));

    // Then all seven own rows show, and the other company stays under its heading
    expect(screen.getAllByTestId("needs-row")).toHaveLength(8);
    expect(screen.getByText("In other companies")).toBeTruthy();
  });

  it("caps another company's group at four rows with its own 'and N more'", () => {
    // Given six needing employees in another company and one here
    show([
      session("a"),
      ...["p", "q", "r", "s", "t", "u"].map((id) =>
        session(id, { machineId: "m2" }),
      ),
    ]);

    // Then that company shows four rows and 'and 2 more'
    expect(screen.getAllByTestId("needs-row")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "and 2 more" })).toBeTruthy();
  });

  it("names the Remote Control link in words: Approve for a permission, Open otherwise", () => {
    // Given one employee asking permission and one waiting, both with a Remote Control link
    show([
      session("a", { state: "needsPermission", bridgeSessionId: "session_a" }),
      session("b", { bridgeSessionId: "session_b" }),
    ]);

    // Then each link reads its verb and the arrow
    const links = screen
      .getAllByTestId("needs-row")
      .map((row) => row.querySelector("a")?.textContent);
    expect(links).toEqual(["Approve ↗", "Open ↗"]);
  });

  it("marks the row of the open card as current", () => {
    // Given two waiting employees and the card of the first open
    show([session("a"), session("b")], { selectedKey: "m1/a" });

    // Then only its row is current
    const current = screen
      .getAllByTestId("needs-row")
      .filter((row) => row.getAttribute("aria-current") === "true");
    expect(current.map((row) => row.getAttribute("data-key"))).toEqual([
      "m1/a",
    ]);
  });

  it("is absent when nobody needs the owner", () => {
    show([session("a", { state: "working" })]);
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("shows no Remote Control link on a row whose window is still opening", () => {
    // Given a Needs permission row that is launching but still has a bridge id
    show([
      session("a", {
        state: "needsPermission",
        waitingAtMac: true,
        bridgeSessionId: "bridge-1",
      }),
    ]);

    // Then the row has no link
    expect(screen.queryByRole("link")).toBeNull();
  });
});
