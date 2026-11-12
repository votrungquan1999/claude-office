// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WentHomeDrawer, type WentHomeRow } from "./WentHomeDrawer";

const row = (key: string, task: string, where: string, time: string) =>
  ({ key, palette: 0, hueShift: 0, task, where, time }) satisfies WentHomeRow;

describe("the went-home drawer", () => {
  afterEach(cleanup);

  it("heads the list with the company, how many employees and newest first, and gives each row its full task name, where it ran and when it went home", () => {
    // Given two departures, one with a task name too long for one line
    const longTask =
      "VN30F single shared model, two decision points (1d_atc), multi-account paper run";
    const rows = [
      row("m1/a", longTask, "Studio Mac / harbor-labs", "13:52"),
      row(
        "m1/b",
        "Fix login redirect",
        "Studio Mac / harbor-labs/web",
        "13:10",
      ),
    ];

    // When the drawer renders
    render(
      <WentHomeDrawer
        companyName="harbor-labs"
        rows={rows}
        sheet={false}
        detailsOpen={false}
        onSelect={() => {}}
        onCloseDetails={() => {}}
        onClose={() => {}}
      />,
    );

    // Then the header names the company and the count
    const dialog = screen.getByRole("dialog", { name: "Went home today" });
    expect(dialog.textContent).toContain(
      "harbor-labs · 2 employees · newest first",
    );

    // And each row shows the task in full, where it ran and the time
    const items = within(screen.getByTestId("went-home-list")).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      `${longTask}Studio Mac / harbor-labs13:52`,
      "Fix login redirectStudio Mac / harbor-labs/web13:10",
    ]);
  });

  it("says 1 employee for a single departure and Nobody has gone home today for none", () => {
    // Given one departure
    const props = {
      companyName: "harbor-labs",
      sheet: false,
      detailsOpen: false,
      onSelect: () => {},
      onCloseDetails: () => {},
      onClose: () => {},
    };
    const { rerender } = render(
      <WentHomeDrawer
        {...props}
        rows={[row("m1/a", "Fix", "Studio Mac / harbor-labs", "09:00")]}
      />,
    );

    // Then the header is singular
    expect(screen.getByRole("dialog").textContent).toContain(
      "harbor-labs · 1 employee · newest first",
    );

    // When nobody is left
    rerender(<WentHomeDrawer {...props} rows={[]} />);

    // Then it says so and lists no rows
    expect(screen.getByRole("dialog").textContent).toContain(
      "Nobody has gone home today",
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("opens a row's details with its key, and closes from the × button and from Escape", () => {
    // Given a drawer with one row
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <WentHomeDrawer
        companyName="harbor-labs"
        rows={[row("m1/a", "Fix", "Studio Mac / harbor-labs", "09:00")]}
        sheet={false}
        detailsOpen={false}
        onSelect={onSelect}
        onCloseDetails={() => {}}
        onClose={onClose}
      />,
    );

    // When the owner presses the row
    fireEvent.click(screen.getByRole("button", { name: /Fix/ }));

    // Then its details are asked for, and the drawer is not closed
    expect(onSelect.mock.calls).toEqual([["m1/a"]]);
    expect(onClose).not.toHaveBeenCalled();

    // When the owner presses × and then Escape
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });

    // Then it asks to close each time
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the Close button on open", () => {
    // When the drawer opens
    render(
      <WentHomeDrawer
        companyName="harbor-labs"
        rows={[]}
        sheet={false}
        detailsOpen={false}
        onSelect={() => {}}
        onCloseDetails={() => {}}
        onClose={() => {}}
      />,
    );

    // Then focus is on its Close button
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
  });

  it("closes only the details card on Escape while one is open above it", () => {
    // Given a details card opened after the drawer
    const onClose = vi.fn();
    const onCloseDetails = vi.fn();
    render(
      <WentHomeDrawer
        companyName="harbor-labs"
        rows={[]}
        sheet={false}
        detailsOpen
        onSelect={() => {}}
        onCloseDetails={onCloseDetails}
        onClose={onClose}
      />,
    );

    // When the owner presses Escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Then the card is asked to close and the drawer is not
    expect(onCloseDetails).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
