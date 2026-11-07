import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { TILE_SIZE } from "./constants";
import type { OfficeState } from "./engine/officeState";
import { getLoadedCharacterCount } from "./sprites/spriteData";

export interface SceneSyncOptions {
  /** The clock used to time state changes; injectable for tests. */
  now?: () => number;
  /** How long a state must hold before the employee walks to its room. */
  smoothMs?: number;
}

export interface SceneSync {
  /** Brings the scene in line with the given sessions; replaying the same sessions changes nothing. */
  apply(sessions: SessionDto[], options?: { firstLoad?: boolean }): void;
  /** Finishes moves whose state has held long enough; call it on the poll clock. */
  tick(): void;
  /** The renderer ids of every employee, in arrival order. */
  agentIds(): number[];
}

interface Employee {
  id: number;
  /** The room the employee was last sent to. */
  room: string;
  /** A different room the state now points at, and since when. */
  pending?: { room: string; since: number };
}

const SMOOTH_MS = 2000;

/** FNV-1a, so a key always hashes to the same number. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return hash >>> 0;
}

/** A character look that depends only on the session, so every reload and device shows the same one. */
function lookOf(key: string): { palette: number; hueShift: number } {
  const hash = hashKey(key);
  return {
    palette: hash % getLoadedCharacterCount(),
    hueShift: (Math.floor(hash / 256) % 8) * 45,
  };
}

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/**
 * Turns session snapshots into employees in the scene.
 * @param office - The scene to drive.
 * @param options - Clock and smoothing window.
 * @returns The sync handle.
 */
export function createSceneSync(
  office: OfficeState,
  { now = Date.now, smoothMs = SMOOTH_MS }: SceneSyncOptions = {},
): SceneSync {
  // The renderer's ids are numbers; sessions are keyed by machine and session.
  const employees = new Map<string, Employee>();
  let nextId = 1;

  /** A free seat inside the room, or undefined when it is full. */
  function freeSeatIn(room: string): string | undefined {
    for (const [uid, seat] of office.seats) {
      if (!seat.assigned && office.seatZone(uid) === room) return uid;
    }
    return undefined;
  }

  /** A walkable tile of the room that is not a seat and has nobody on it. */
  function freeFloorIn(room: string): { col: number; row: number } | undefined {
    const { cols, areaTiles } = office.getLayout();
    const taken = new Set(
      office.getCharacters().map((ch) => `${ch.tileCol},${ch.tileRow}`),
    );
    return office.walkableTiles.find(
      ({ col, row }) =>
        areaTiles?.[row * cols + col] === room &&
        office.getSeatAtTile(col, row) === null &&
        !taken.has(`${col},${row}`),
    );
  }

  /** Gives up the employee's seat and puts it on the room's floor; arrivals appear there, others walk. */
  function standInRoom(id: number, room: string, arriving: boolean): void {
    const character = office.characters.get(id);
    const tile = freeFloorIn(room);
    if (!character || !tile) return;
    const seat = character.seatId ? office.seats.get(character.seatId) : null;
    if (seat) seat.assigned = false;
    character.seatId = null;
    character.standingRoom = room;
    if (!arriving) {
      office.walkToTile(id, tile.col, tile.row);
      return;
    }
    character.tileCol = tile.col;
    character.tileRow = tile.row;
    character.x = tile.col * TILE_SIZE + TILE_SIZE / 2;
    character.y = tile.row * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Busy look and permission bubble follow the state at once; only the walk between rooms is smoothed. */
  function showState(id: number, state: SessionDto["state"]): void {
    const busy = state !== "waiting" && state !== "wentHome";
    if (office.characters.get(id)?.isActive !== busy) {
      office.setAgentActive(id, busy);
    }
    // Re-asserted on every sync: other renderer paths can clear the bubble.
    if (state === "needsPermission") office.showPermissionBubble(id);
    else office.clearPermissionBubble(id);
  }

  /** Sends the employee to its pending room once the state has held for the smoothing window. */
  function moveIfSettled(employee: Employee): void {
    const { pending } = employee;
    if (!pending || now() - pending.since < smoothMs) return;
    const seat = freeSeatIn(pending.room);
    if (seat) office.reassignSeat(employee.id, seat);
    else standInRoom(employee.id, pending.room, false);
    employee.room = pending.room;
    employee.pending = undefined;
  }

  return {
    apply(sessions, { firstLoad = false } = {}) {
      for (const session of sessions) {
        const key = sessionKey(session);
        const label = `${session.machineName} / ${folderName(session.cwd)}`;
        // Each non-home state has a room of the same name.
        const room = session.state;
        const employee = employees.get(key);
        if (!employee) {
          const id = nextId++;
          employees.set(key, { id, room });
          const seat = freeSeatIn(room);
          // Anyone already here on the first load just sits down; later arrivals show the spawn effect.
          const { palette, hueShift } = lookOf(key);
          office.addAgent(id, palette, hueShift, seat, firstLoad, label);
          if (!seat) standInRoom(id, room, true);
          showState(id, session.state);
          continue;
        }
        const character = office.characters.get(employee.id);
        if (character) character.directoryName = label;
        showState(employee.id, session.state);
        if (room === employee.room) {
          employee.pending = undefined;
          continue;
        }
        if (employee.pending?.room !== room) {
          employee.pending = { room, since: now() };
        }
        moveIfSettled(employee);
      }
    },
    tick() {
      for (const employee of employees.values()) moveIfSettled(employee);
    },
    agentIds: () => [...employees.values()].map((employee) => employee.id),
  };
}
