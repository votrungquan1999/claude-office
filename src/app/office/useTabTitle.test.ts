// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTabTitle } from "./useTabTitle";

afterEach(() => {
  document.title = "Claude Office";
});

describe("the tab title", () => {
  it("shows the count in front of the name, plain name at zero, and the plain name again once the office closes", () => {
    // Given an office that shows 3 employees needing the owner
    const { rerender, unmount } = renderHook(
      ({ count }) => useTabTitle(count),
      { initialProps: { count: 3 } },
    );

    // Then the title leads with the count
    expect(document.title).toBe("(3) Claude Office");

    // When the count drops to zero
    rerender({ count: 0 });

    // Then the title is the plain name
    expect(document.title).toBe("Claude Office");

    // When it climbs again and the office closes
    rerender({ count: 8 });
    expect(document.title).toBe("(8) Claude Office");
    unmount();

    // Then the plain name is back
    expect(document.title).toBe("Claude Office");
  });
});
