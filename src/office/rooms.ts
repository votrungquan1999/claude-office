import type { SessionState } from "@/shared/session-state";

/** The four rooms of the office; the values are the Area labels stored in the layout. */
export enum Room {
  Working = "working",
  NeedsPermission = "needsPermission",
  WaitingForYou = "waitingForYou",
  Idle = "idle",
}

/** Rooms in the order they appear on screen, top to bottom, left to right. */
export const ROOM_ORDER: Room[] = [
  Room.Working,
  Room.NeedsPermission,
  Room.WaitingForYou,
  Room.Idle,
];

/** The sign each room shows. */
export const ROOM_DISPLAY_NAMES: Record<Room, string> = {
  [Room.Working]: "Working",
  [Room.NeedsPermission]: "Needs permission",
  [Room.WaitingForYou]: "Waiting for you",
  [Room.Idle]: "Idle",
};

/** The room each session state sends an employee to; a session that went home keeps its current room. */
export const ROOM_OF_STATE: Record<SessionState, Room | null> = {
  working: Room.Working,
  thinking: Room.Working,
  needsPermission: Room.NeedsPermission,
  waitingForYou: Room.WaitingForYou,
  idle: Room.Idle,
  wentHome: null,
};
