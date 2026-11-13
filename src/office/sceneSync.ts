import type { CompanySessionInput, SessionCompany } from "@/shared/companies";
import { folderName } from "@/shared/employee-name";
import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { tagLabels } from "@/shared/tag-labels";
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
      /** Places a session in its company, so the label can name its project or company; without it the label names the folder. */
      companyOf?(session: CompanySessionInput): SessionCompany | null;
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
export function lookOf(key: string): { palette: number; hueShift: number } {
  const hash = hashKey(key);
  return {
    palette: hash % getLoadedCharacterCount(),
    hueShift: (Math.floor(hash / 256) % 8) * 45,
  };
}

/**
 * The `#name` words for a session's repo tags.
 * @param tags - The session's tags.
 * @param labels - How the company writes each tag key, so a word reads like its filter chip.
 * @returns One word per tag.
 */
function tagWords(
  tags: SessionDto["tags"],
  labels: ReadonlyMap<string, string>,
): string[] {
  return (tags ?? []).map(({ name, key }) => `#${labels.get(key) ?? name}`);
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

  /** The walkable floor tiles of the room that are not a seat or a doorway: free ones first, lowest rows first so extras stay clear of the art on the wall. */
  function floorTilesIn(
    room: string,
    exceptId?: number,
  ): Array<{ col: number; row: number }> {
    const { cols, areaTiles } = office.getLayout();
    // A walker counts where it is heading, so employees arriving together do not pick the same tile.
    const taken = new Set(
      office
        .getCharacters()
        .filter((ch) => ch.id !== exceptId)
        .map((ch) => {
          const goal = ch.path[ch.path.length - 1];
          return `${goal?.col ?? ch.tileCol},${goal?.row ?? ch.tileRow}`;
        }),
    );
    const isTaken = ({ col, row }: { col: number; row: number }) =>
      taken.has(`${col},${row}`);
    return office.walkableTiles
      .filter(
        ({ col, row }) =>
          areaTiles?.[row * cols + col] === room &&
          office.getSeatAtTile(col, row) === null &&
          !isDoorway(col, row),
      )
      .sort(
        (a, b) =>
          Number(isTaken(a)) - Number(isTaken(b)) ||
          b.row - a.row ||
          a.col - b.col,
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
    const floor = floorTilesIn(room, id);
    if (floor.length === 0) return;
    if (!arriving) {
      // A walled-in pocket of floor has no path, so the next tile is tried
      floor.some((tile) => office.walkToTile(id, tile.col, tile.row));
      return;
    }
    const tile = floor[0];
    // The look it took from the seat it just gave up would sit it down in mid-air
    character.pose = "stand";
    character.standing = true;
    character.tileCol = tile.col;
    character.tileRow = tile.row;
    character.x = tile.col * TILE_SIZE + TILE_SIZE / 2;
    character.y = tile.row * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Busy look and bubbles follow the state at once; only the walk between rooms is smoothed. */
  function showState(id: number, state: SessionDto["state"]): void {
    const busy =
      state !== "idle" &&
      state !== "waitingForYou" &&
      state !== "review" &&
      state !== "wentHome";
    if (office.characters.get(id)?.isActive !== busy) {
      office.setAgentActive(id, busy);
    }
    // Re-asserted on every sync: other renderer paths can clear the bubble.
    if (state === "needsPermission") office.showPermissionBubble(id);
    else office.clearPermissionBubble(id);
    if (state === "waitingForYou") office.showStateBubble(id, "asks");
    else office.clearStateBubble(id, "asks");
    if (state === "review") office.showStateBubble(id, "review");
    else office.clearStateBubble(id, "review");
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
    apply(
      sessions,
      { firstLoad = false, offlineMachineIds, only, companyOf } = {},
    ) {
      offline = offlineMachineIds ?? offline;
      // Per company, over the tags of its live sessions: the same set the tag filter's chips read.
      const labelsByCompany = new Map<string | null, Map<string, string>>();
      const byCompany = Map.groupBy(
        sessions.filter((session) => session.state !== "wentHome"),
        (session) => companyOf?.(session)?.companyKey ?? null,
      );
      for (const [companyKey, group] of byCompany) {
        labelsByCompany.set(
          companyKey,
          tagLabels(group.flatMap((session) => session.tags ?? [])),
        );
      }
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
        const placed = companyOf?.(session);
        // A session that started at its company folder has no project, so the company names its place.
        const where = placed
          ? (placed.project ?? placed.companyName)
          : folderName(session.cwd);
        const place = [
          `${session.machineName} / ${where}`,
          ...tagWords(
            session.tags,
            labelsByCompany.get(placed?.companyKey ?? null) ?? new Map(),
          ),
        ].join(" ");
        // No folder fallback: the place already names the folder
        const name = session.ownerName ?? session.deskName;
        const label = name ? `${name} · ${place}` : place;
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
