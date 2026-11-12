import { describe, expect, it } from "vitest";
import { Room, STACKED_ROOM_ORDER } from "./rooms";

describe("the stacked room order", () => {
  it("puts the rooms that need the owner first", () => {
    expect(STACKED_ROOM_ORDER).toEqual([
      Room.NeedsPermission,
      Room.WaitingForYou,
      Room.Working,
      Room.Idle,
    ]);
  });
});
