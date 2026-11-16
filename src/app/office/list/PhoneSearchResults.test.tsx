// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PhoneSearchResults } from "./PhoneSearchResults";

function show(allCompanies: boolean) {
  render(
    <PhoneSearchResults
      result={{ own: [], wentHome: [], others: [], total: 0 }}
      companyName="personal"
      allCompanies={allCompanies}
      onSearchAll={() => {}}
      selectedKey={null}
      offlineMachineIds={new Set()}
      tagLabels={new Map()}
      serverOffsetMs={0}
      onSelect={() => {}}
      onSelectDeparture={() => {}}
      onSelectElsewhere={() => {}}
      onMoveToIdle={() => {}}
    />,
  );
}

describe("a phone search with no match", () => {
  afterEach(cleanup);

  it("names the viewed company until every company is searched, then says no company has a match", () => {
    // When only the viewed company was searched
    show(false);

    // Then the line names it
    expect(screen.getByRole("status").textContent).toBe("No match in personal");
    cleanup();

    // When every company was searched
    show(true);

    // Then the line says none has a match
    expect(screen.getByRole("status").textContent).toBe(
      "No match in any company",
    );
  });
});
