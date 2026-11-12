// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WentHomeButton } from "./WentHomeButton";

describe("the went-home button", () => {
  afterEach(cleanup);

  it("shows its label with the count, even at zero, reports whether the drawer is open, and asks once when pressed", () => {
    // Given a closed button with nobody home
    const onClick = vi.fn();
    const { rerender } = render(
      <WentHomeButton
        label="Went home today"
        count={0}
        open={false}
        onClick={onClick}
      />,
    );
    const button = screen.getByTestId("went-home-button");

    // Then it reads the label and 0, and is closed
    expect(button.textContent).toBe("Went home today0");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");

    // When it is pressed
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    // And the count grows while the drawer is open
    rerender(
      <WentHomeButton
        label="Went home today"
        count={7}
        open
        onClick={onClick}
      />,
    );
    expect(button.textContent).toBe("Went home today7");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});
