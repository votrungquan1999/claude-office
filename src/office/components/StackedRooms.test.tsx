// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Room } from "../rooms";
import { StackedRooms, type StackedTile } from "./StackedRooms";

vi.mock("./CharacterMugShot", () => ({ CharacterMugShot: () => null }));

const tile = (key: string, overrides: Partial<StackedTile> = {}) => ({
  key,
  room: Room.Working,
  task: key,
  palette: 0,
  hueShift: 0,
  state: "working" as const,
  offline: false,
  since: 0,
  ...overrides,
});

describe("the stacked rooms", () => {
  afterEach(cleanup);

  it("puts the employee who has been in a room longest first, ties by session key", () => {
    // Given four employees in Working, entered at different times, two at the same moment
    const tiles = [
      tile("m1\0c", { since: 300 }),
      tile("m1\0b", { since: 100 }),
      tile("m1\0z", { since: 200, task: "a task" }),
      tile("m1\0a", { since: 200, task: "z task" }),
    ];

    // When the rooms render
    render(
      <StackedRooms tiles={tiles} selectedKey={null} onSelect={vi.fn()} />,
    );

    // Then the room lists them oldest first, the tie broken by session key
    const names = within(screen.getByRole("region", { name: "Working" }))
      .getAllByRole("button", { name: /, Working$/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "m1\0b, Working",
      "z task, Working",
      "a task, Working",
      "m1\0c, Working",
    ]);
  });

  it("shows ! on a permission request and … on an employee waiting for the owner, and dims an employee on an offline Mac", () => {
    // Given employees in the permission, waiting and working rooms, the working one on an offline Mac
    const tiles = [
      tile("p", {
        room: Room.NeedsPermission,
        state: "needsPermission",
        task: "ask",
      }),
      tile("w", {
        room: Room.WaitingForYou,
        state: "waitingForYou",
        task: "wait",
      }),
      tile("k", { task: "busy", offline: true }),
    ];

    // When the rooms render
    render(
      <StackedRooms tiles={tiles} selectedKey={null} onSelect={vi.fn()} />,
    );

    // Then the bubbles show on the first two only, and the offline employee is dimmed
    const bubbleOf = (name: RegExp) =>
      screen.getByRole("button", { name }).textContent;
    expect(bubbleOf(/^ask,/)).toContain("!");
    expect(bubbleOf(/^wait,/)).toContain("…");
    expect(bubbleOf(/^busy,/)).toBe("busy");
    expect(screen.getByRole("button", { name: /^busy,/ }).style.opacity).toBe(
      "0.5",
    );
    expect(screen.getByRole("button", { name: /^ask,/ }).style.opacity).toBe(
      "1",
    );
  });
});
