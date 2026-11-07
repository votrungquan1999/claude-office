import type { SessionState } from "@/shared/session-state";

/** The four rooms of the office; the values are the Area labels stored in the layout. */
export enum Room {
  Working = "working",
  Thinking = "thinking",
  NeedsPermission = "needsPermission",
  Waiting = "waiting",
}

/** Rooms in the order they appear on screen, top to bottom. */
export const ROOM_ORDER: Room[] = [
  Room.Working,
  Room.Thinking,
  Room.NeedsPermission,
  Room.Waiting,
];

/** The sign each room shows. */
export const ROOM_DISPLAY_NAMES: Record<Room, string> = {
  [Room.Working]: "Working",
  [Room.Thinking]: "Thinking",
  [Room.NeedsPermission]: "Needs permission",
  [Room.Waiting]: "Waiting",
};

/** The room each session state sends an employee to; a session that went home keeps its current room. */
export const ROOM_OF_STATE: Record<SessionState, Room | null> = {
  working: Room.Working,
  thinking: Room.Thinking,
  needsPermission: Room.NeedsPermission,
  waiting: Room.Waiting,
  wentHome: null,
};
