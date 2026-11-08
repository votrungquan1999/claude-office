import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { TILE_SIZE } from "./constants";
import type { OfficeState } from "./engine/officeState";
import { ROOM_OF_STATE, Room } from "./rooms";
import { getLoadedCharacterCount } from "./sprites/spriteData";
import { TileType } from "./types";

export interface SceneSyncOptions {
  /** The clock used to time state changes; injectable for tests. */
  now?: () => number;
  /** How long a state must hold before the employee walks to its room. */
  smoothMs?: number;
}

export interface SceneSync {
  /** Brings the scene in line with the given sessions; replaying the same sessions changes nothing. */
  apply(
    sessions: SessionDto[],
    options?: {
      firstLoad?: boolean;
      offlineMachineIds?: ReadonlySet<string>;
      /** Keys of the sessions the scene may show; every other employee leaves at once, with no despawn effect. */
      only?: ReadonlySet<string>;
    },
  ): void;
  /** Finishes moves whose state has held long enough; call it on the poll clock. */
  tick(): void;
  /** The "machineId/sessionId" key of the session behind a renderer id. */
  sessionKeyOf(id: number): string | undefined;
  /** The renderer ids of every employee, in arrival order. */
  agentIds(): number[];
  /** How many employees each room holds, by the room they were last sent to. */
  roomCounts(): Record<string, number>;
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

  /** Whether the tile sits in a gap of a wall (walls on both sides), where a stander would block the way. */
  function isDoorway(col: number, row: number): boolean {
    const { cols, tiles } = office.getLayout();
    const wall = (c: number, r: number) =>
      tiles[r * cols + c] === TileType.WALL;
    return (
      (wall(col - 1, row) && wall(col + 1, row)) ||
      (wall(col, row - 1) && wall(col, row + 1))
    );
  }

  /** A walkable floor tile of the room that is not a seat or a doorway; a free one first, else any. */
  function floorIn(room: string): { col: number; row: number } | undefined {
    const { cols, areaTiles } = office.getLayout();
    const taken = new Set(
      office.getCharacters().map((ch) => `${ch.tileCol},${ch.tileRow}`),
    );
    const floor = office.walkableTiles.filter(
      ({ col, row }) =>
        areaTiles?.[row * cols + col] === room &&
        office.getSeatAtTile(col, row) === null &&
        !isDoorway(col, row),
    );
    return (
      floor.find(({ col, row }) => !taken.has(`${col},${row}`)) ?? floor[0]
    );
  }

  /** Gives up the employee's seat and puts it on the room's floor; arrivals appear there, others walk. */
  function standInRoom(id: number, room: string, arriving: boolean): void {
    const character = office.characters.get(id);
    if (!character) return;
    const seat = character.seatId ? office.seats.get(character.seatId) : null;
    if (seat) seat.assigned = false;
    character.seatId = null;
    // Even on a full floor the employee belongs to the room, so its wandering stays inside it.
    character.standingRoom = room;
    const tile = floorIn(room);
    if (!tile) return;
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
    const busy =
      state !== "idle" && state !== "waitingForYou" && state !== "wentHome";
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

  let offline: ReadonlySet<string> = new Set();

  /** Flags the employee when its Mac has stopped sending heartbeats. */
  function markOffline(id: number, session: SessionDto): void {
    const character = office.characters.get(id);
    if (character) character.macOffline = offline.has(session.machineId);
  }

  return {
    apply(sessions, { firstLoad = false, offlineMachineIds, only } = {}) {
      offline = offlineMachineIds ?? offline;
      if (only) {
        for (const [key, employee] of employees) {
          if (only.has(key)) continue;
          office.removeAgentNow(employee.id);
          employees.delete(key);
        }
      }
      for (const session of sessions) {
        const key = sessionKey(session);
        if (only && !only.has(key)) continue;
        const place = `${session.machineName} / ${folderName(session.cwd)}`;
        const label = session.deskName
          ? `${session.deskName} · ${place}`
          : place;
        const employee = employees.get(key);
        if (session.state === "wentHome") {
          // The renderer finishes the despawn on its own; a resume later gets a fresh id, so it never meets the leaver.
          if (employee) {
            office.removeAgent(employee.id);
            employees.delete(key);
          }
          continue;
        }
        const room =
          ROOM_OF_STATE[session.state] ?? employee?.room ?? Room.Idle;
        if (!employee) {
          const id = nextId++;
          employees.set(key, { id, room });
          const seat = freeSeatIn(room);
          // Anyone already here on the first load just sits down; later arrivals show the spawn effect.
          const { palette, hueShift } = lookOf(key);
          office.addAgent(id, palette, hueShift, seat, firstLoad, label);
          if (!seat) standInRoom(id, room, true);
          showState(id, session.state);
          markOffline(id, session);
          continue;
        }
        const character = office.characters.get(employee.id);
        if (character) character.directoryName = label;
        showState(employee.id, session.state);
        markOffline(employee.id, session);
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
    sessionKeyOf: (id) =>
      [...employees.entries()].find(([, employee]) => employee.id === id)?.[0],
    agentIds: () => [...employees.values()].map((employee) => employee.id),
    roomCounts() {
      const counts: Record<string, number> = {};
      for (const { room } of employees.values()) {
        counts[room] = (counts[room] ?? 0) + 1;
      }
      return counts;
    },
  };
}
