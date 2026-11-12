// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

  it("folds a room to its header when the owner taps it, keeps the count, and opens it on the next tap", () => {
    // Given two employees in Working and one in Idle
    const tiles = [
      tile("a", { task: "first" }),
      tile("b", { task: "second" }),
      tile("c", { room: Room.Idle, state: "idle", task: "rest" }),
    ];
    render(
      <StackedRooms tiles={tiles} selectedKey={null} onSelect={vi.fn()} />,
    );
    const header = screen.getByRole("button", { name: "Working, 2" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.getAttribute("aria-controls")).toBe(
      within(screen.getByRole("region", { name: "Working" })).getAllByRole(
        "button",
        { name: /, Working$/ },
      )[0].parentElement?.id,
    );

    // When the owner taps the Working header
    fireEvent.click(header);

    // Then its tiles are gone, the count stays, and Idle is untouched
    expect(screen.queryByRole("button", { name: /^first,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^second,/ })).toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.hasAttribute("aria-controls")).toBe(false);
    expect(header.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /^rest,/ })).toBeTruthy();

    // When the owner taps it again
    fireEvent.click(header);

    // Then the tiles are back
    expect(screen.getByRole("button", { name: /^first,/ })).toBeTruthy();
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a hidden caret after the count, down while a room is open and right once folded, and none on an empty room", () => {
    // Given Working with one employee and the other rooms empty
    render(
      <StackedRooms
        tiles={[tile("a", { task: "first" })]}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const header = screen.getByRole("button", { name: "Working, 1" });
    const caretOf = (el: HTMLElement) =>
      el.querySelector('[aria-hidden="true"]:last-child');

    // Then the open room shows a down caret that is hidden from screen readers
    expect(caretOf(header)?.textContent).toBe("▼");

    // When the owner folds it, the caret points right
    fireEvent.click(header);
    expect(caretOf(header)?.textContent).toBe("▶");

    // And an empty room has no caret
    const idle = screen.getByRole("region", { name: "Idle" });
    expect(idle.textContent).not.toMatch(/[▼▶]/);
  });

  it("opens a folded Needs permission room when someone new arrives, but not a folded Idle room, and not on a re-render of the same people", () => {
    // Given folded Needs permission and Idle rooms with one employee each
    const ask = (key: string) =>
      tile(key, {
        room: Room.NeedsPermission,
        state: "needsPermission",
        task: key,
      });
    const rest = (key: string) =>
      tile(key, { room: Room.Idle, state: "idle", task: key });
    const props = { selectedKey: null, onSelect: vi.fn() };
    const { rerender } = render(
      <StackedRooms tiles={[ask("p1"), rest("i1")]} {...props} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Needs permission, 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Idle, 1" }));

    // When the same employees come back in a poll
    rerender(<StackedRooms tiles={[ask("p1"), rest("i1")]} {...props} />);

    // Then both rooms stay folded
    expect(screen.queryByRole("button", { name: /^p1,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^i1,/ })).toBeNull();

    // When a new employee arrives in each
    rerender(
      <StackedRooms
        tiles={[ask("p1"), ask("p2"), rest("i1"), rest("i2")]}
        {...props}
      />,
    );

    // Then Needs permission opens and Idle stays folded
    expect(screen.getByRole("button", { name: /^p2,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^i2,/ })).toBeNull();
  });

  it("opens a folded Needs permission room when an employee already on screen moves into it", () => {
    // Given a folded Needs permission room and an employee working
    const ask = (key: string) =>
      tile(key, {
        room: Room.NeedsPermission,
        state: "needsPermission",
        task: key,
      });
    const props = { selectedKey: null, onSelect: vi.fn() };
    const { rerender } = render(
      <StackedRooms tiles={[ask("p1"), tile("w1")]} {...props} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Needs permission, 1" }),
    );
    expect(screen.queryByRole("button", { name: /^p1,/ })).toBeNull();

    // When that same employee asks for permission
    rerender(<StackedRooms tiles={[ask("p1"), ask("w1")]} {...props} />);

    // Then the room opens with both
    expect(screen.getByRole("button", { name: /^w1,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^p1,/ })).toBeTruthy();
  });

  it("opens a folded Waiting for you room when someone new arrives", () => {
    // Given a folded Waiting for you room with one employee
    const wait = (key: string) =>
      tile(key, {
        room: Room.WaitingForYou,
        state: "waitingForYou",
        task: key,
      });
    const props = { selectedKey: null, onSelect: vi.fn() };
    const { rerender } = render(
      <StackedRooms tiles={[wait("q1")]} {...props} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Waiting for you, 1" }));
    expect(screen.queryByRole("button", { name: /^q1,/ })).toBeNull();

    // When a new employee arrives there
    rerender(<StackedRooms tiles={[wait("q1"), wait("q2")]} {...props} />);

    // Then the room opens with both
    expect(screen.getByRole("button", { name: /^q2,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^q1,/ })).toBeTruthy();
  });

  it("keeps a folded Needs permission room folded when someone arrives in a different room", () => {
    // Given a folded Needs permission room whose tiles will not change
    const ask = tile("p1", {
      room: Room.NeedsPermission,
      state: "needsPermission",
      task: "p1",
    });
    const props = { selectedKey: null, onSelect: vi.fn() };
    const { rerender } = render(<StackedRooms tiles={[ask]} {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Needs permission, 1" }),
    );

    // When a new employee arrives in Working
    rerender(<StackedRooms tiles={[ask, tile("w1")]} {...props} />);

    // Then the new employee shows and Needs permission stays folded
    expect(screen.getByRole("button", { name: /^w1,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^p1,/ })).toBeNull();
  });
});
