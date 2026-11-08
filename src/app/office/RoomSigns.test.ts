import { describe, expect, it } from "vitest";
import { Room } from "@/office/rooms";
import { TILE_SIZE } from "@/office/types";
import { loadOffice } from "@/test/load-office";
import { roomAnchors, signText } from "./RoomSigns";

describe("where each room's sign hangs", () => {
  it("hangs the bottom rooms' signs on the shared wall row, not over the top rooms' floor", () => {
    // Given the layout, whose bottom rooms have doorway tiles in the shared wall row
    const anchors = roomAnchors(loadOffice());
    const signRow = (room: Room) =>
      (anchors.find((a) => a.room === room)?.worldY ?? 0) / TILE_SIZE;

    // When each sign's row is read
    // Then the top rooms' signs sit on wall row 1 and the bottom rooms' on the shared wall row 11
    expect(signRow(Room.Working)).toBe(1);
    expect(signRow(Room.NeedsPermission)).toBe(1);
    expect(signRow(Room.WaitingForYou)).toBe(11);
    expect(signRow(Room.Idle)).toBe(11);
  });
});

describe("what each room's sign says", () => {
  it("adds employees / seats only when more employees are in the room than it has seats", () => {
    // Given a room with 12 seats
    // Then the sign is the plain name at or below 12 employees, and counts above it
    expect(signText(Room.NeedsPermission, 12, 12)).toBe("Needs permission");
    expect(signText(Room.NeedsPermission, 13, 12)).toBe(
      "Needs permission 13 / 12",
    );
  });
});
