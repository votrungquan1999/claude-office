import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import type { OfficeState } from "./engine/officeState";

export interface SceneSync {
  /** Brings the scene in line with the given sessions; replaying the same sessions changes nothing. */
  apply(sessions: SessionDto[], options?: { firstLoad?: boolean }): void;
  /** The renderer ids of every employee, in arrival order. */
  agentIds(): number[];
}

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/**
 * Turns session snapshots into employees in the scene.
 * @param office - The scene to drive.
 * @returns The sync handle.
 */
export function createSceneSync(office: OfficeState): SceneSync {
  // The renderer's ids are numbers; sessions are keyed by machine and session.
  const ids = new Map<string, number>();
  let nextId = 1;

  return {
    apply(sessions, { firstLoad = false } = {}) {
      for (const session of sessions) {
        const key = sessionKey(session);
        const label = `${session.machineName} / ${folderName(session.cwd)}`;
        let id = ids.get(key);
        if (id === undefined) {
          id = nextId++;
          ids.set(key, id);
          // Anyone already here on the first load just sits down; later arrivals show the spawn effect.
          office.addAgent(
            id,
            undefined,
            undefined,
            undefined,
            firstLoad,
            label,
          );
        } else {
          const employee = office.characters.get(id);
          if (employee) employee.directoryName = label;
        }
      }
    },
    agentIds: () => [...ids.values()],
  };
}
