// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDto, StepDto } from "@/shared/session";
import { StepsList } from "./StepsList";

// Relative to now so the week-old cutoff never turns these fixtures stale.
const T0 = Date.now() - 3_600_000;

function step(n: number, extra: Partial<StepDto> = {}): StepDto {
  return {
    id: n.toString(16).padStart(24, "0"),
    text: `Step ${n}`,
    startedAt: new Date(T0 + n * 1000).toISOString(),
    durationMs: 100,
    status: "ok",
    ...extra,
  };
}

function session(recentSteps: StepDto[]): SessionDto {
  return {
    machineId: "m1",
    machineName: "Mac",
    sessionId: "s1",
    cwd: "/work",
    state: "working",
    startedAt: new Date(T0).toISOString(),
    changedAt: new Date(T0).toISOString(),
    recentSteps,
  };
}

function page(steps: StepDto[], next?: string) {
  return new Response(JSON.stringify({ steps, ...(next ? { next } : {}) }));
}

const listed = () =>
  screen.getAllByRole("listitem").map((li) => li.textContent);

describe("the steps list", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says when older steps could not be loaded and loads them on a retry", async () => {
    // Given a full list whose first "Show more" request fails and second succeeds
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(page([step(3), step(2)]));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <StepsList session={session([5, 6, 7, 8, 9].map((n) => step(n)))} />,
    );

    // When the owner asks for more and it fails
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    // Then an error shows, the button stays, and the list is unchanged
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load older steps",
    );
    expect(listed()).toHaveLength(5);

    // When the owner tries again
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    // Then the older steps appear and the error is gone
    expect(await screen.findByText(/Step 2/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(listed()).toHaveLength(7);
  });

  it("keeps every loaded step once when live steps arrive after 'Show more', and updates a changed step in place", async () => {
    // Given older steps loaded (the page overlaps the live list by one step)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(page([step(5), step(4), step(3)])),
    );
    const live = [5, 6, 7, 8, 9].map((n) => step(n));
    const { rerender } = render(<StepsList session={session(live)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByText(/Step 3/);

    // When a new step arrives (step 5 leaves the live list) and step 9 gets a new duration
    rerender(
      <StepsList
        session={session([
          step(6),
          step(7),
          step(8),
          step(9, { durationMs: 4500 }),
          step(10),
        ])}
      />,
    );

    // Then each step shows once, nothing vanished, and step 9 shows its new duration
    expect(listed()).toEqual([
      "Step 3 · 100 ms",
      "Step 4 · 100 ms",
      "Step 5 · 100 ms",
      "Step 6 · 100 ms",
      "Step 7 · 100 ms",
      "Step 8 · 100 ms",
      "Step 9 · 4.5 s",
      "Step 10 · 100 ms",
    ]);
  });

  it("keeps showing only the last 5 steps when live steps arrive before 'Show more' is used", () => {
    // Given the live list of 5 steps
    vi.stubGlobal("fetch", vi.fn());
    const { rerender } = render(
      <StepsList session={session([5, 6, 7, 8, 9].map((n) => step(n)))} />,
    );

    // When a new step arrives and the oldest leaves the live list
    rerender(
      <StepsList session={session([6, 7, 8, 9, 10].map((n) => step(n)))} />,
    );

    // Then the list still shows 5 steps and "Show more" is still offered
    expect(listed()).toHaveLength(5);
    expect(listed()[0]).toContain("Step 6");
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("shows a run time below zero as 0 ms and hides steps older than a week, including ones loaded by 'Show more'", async () => {
    // Given a recent list with a negative run time and a step from eight days ago, and an older page with another
    const eightDays = 8 * 86_400_000;
    const ancient = (n: number) =>
      step(n, { startedAt: new Date(T0 - eightDays + n).toISOString() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(page([step(3), ancient(2)])),
    );
    render(
      <StepsList
        session={session([
          ancient(4),
          step(5, { durationMs: -20 }),
          step(6),
          step(7),
          step(8),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByText(/Step 3/);

    // Then only steps from the last week show, and the negative time reads 0 ms
    expect(listed()).toEqual([
      "Step 3 · 100 ms",
      "Step 5 · 0 ms",
      "Step 6 · 100 ms",
      "Step 7 · 100 ms",
      "Step 8 · 100 ms",
    ]);
  });
});
