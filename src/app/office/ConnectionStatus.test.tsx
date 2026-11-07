// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus";

const NOW = Date.parse("2026-11-08T10:00:00.000Z");

describe("the office's freshness notice", () => {
  afterEach(cleanup);

  it("shows how long ago the office last updated, and a warning only while the connection is lost", () => {
    // When the last update was 3 minutes ago and the connection works
    const { rerender } = render(
      <ConnectionStatus
        lastUpdatedAt={NOW - 3 * 60_000}
        connectionLost={false}
        now={NOW}
      />,
    );

    // Then it says so, with no warning
    expect(screen.getByText("Updated 3 min ago")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // When the connection is lost
    rerender(
      <ConnectionStatus
        lastUpdatedAt={NOW - 3 * 60_000}
        connectionLost
        now={NOW}
      />,
    );

    // Then a warning appears, and the age is still shown
    expect(screen.getByRole("alert").textContent).toContain("Connection lost");
    expect(screen.getByText("Updated 3 min ago")).toBeTruthy();

    // And a fresh update reads "just now"
    rerender(
      <ConnectionStatus
        lastUpdatedAt={NOW - 20_000}
        connectionLost={false}
        now={NOW}
      />,
    );
    expect(screen.getByText("Updated just now")).toBeTruthy();
  });
});
