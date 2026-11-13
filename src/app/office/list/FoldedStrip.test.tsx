// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldedStrip } from "./FoldedStrip";

function badge(total: number) {
  render(<FoldedStrip total={total} inOtherCompanies={0} onOpen={() => {}} />);
  return screen.getByText(`! ${total}`);
}

describe("the folded strip's count badge", () => {
  afterEach(cleanup);

  it("is muted with nobody waiting and carries the dark text of the lit badge only when someone is", () => {
    // Given a strip with nobody needing the owner
    const quiet = badge(0);

    // Then its badge has only the muted text colour
    expect(quiet.className).toContain("text-text-muted");
    expect(quiet.className).not.toContain("text-bg-dark");

    cleanup();

    // And with someone waiting the badge is lit with the dark text and no muted colour
    const lit = badge(3);
    expect(lit.className).toContain("bg-room-permission");
    expect(lit.className).toContain("text-bg-dark");
    expect(lit.className).not.toContain("text-text-muted");
  });
});
