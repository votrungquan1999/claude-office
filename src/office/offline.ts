import type { MachineDto } from "@/shared/session";

/** Three missed heartbeats (one a minute). */
const OFFLINE_AFTER_MS = 180_000;

/** Why the office cannot give a Mac an order. */
export enum MacBlock {
  Offline = "offline",
  Outdated = "outdated",
}

/** The first agent version that takes orders from the office. */
export const MIN_AGENT_VERSION = "0.3.0";

/** The first agent version whose Dismiss ends the conversation and closes its window; older agents only stop keeping the employee. */
export const DISMISS_MIN_AGENT_VERSION = "0.4.0";

/** Reads "major.minor.patch" into numbers; undefined for anything else. */
function parseVersion(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
}

/** Whether an agent's reported version is missing, unreadable or older than `minimum`. */
function isOlderThan(version: string | undefined, minimum: string): boolean {
  const have = version === undefined ? undefined : parseVersion(version);
  const need = parseVersion(minimum);
  if (!have || !need) return true;
  for (let part = 0; part < 3; part++) {
    if (have[part] !== need[part]) return have[part] < need[part];
  }
  return false;
}

/**
 * Whether a Mac can take orders. A Mac with no record is gone (records expire after a week) and counts as offline; an agent older than 0.3.0 never claims orders.
 * @param machine - The Mac's record, or undefined when it has none.
 * @param serverNow - The server's time; never the browser's clock.
 * @returns Why it cannot take orders, or undefined when it can.
 */
export function macBlock(
  machine: MachineDto | undefined,
  serverNow: string,
): MacBlock | undefined {
  if (!machine) return MacBlock.Offline;
  if (
    Date.parse(serverNow) - Date.parse(machine.lastSeenAt) >
    OFFLINE_AFTER_MS
  ) {
    return MacBlock.Offline;
  }
  return isOlderThan(machine.agentVersion, MIN_AGENT_VERSION)
    ? MacBlock.Outdated
    : undefined;
}

/**
 * The Macs that have gone quiet.
 * @param machines - Every Mac with its last heartbeat.
 * @param serverNow - The server's time sent with the same answer; never the browser's clock.
 * @param seenMachineIds - Macs the office holds sessions or folders of; any without a record counts as offline too.
 * @returns The ids of Macs that cannot take orders because they are quiet or unknown.
 */
export function offlineMachineIds(
  machines: MachineDto[],
  serverNow: string,
  seenMachineIds: Iterable<string> = [],
): Set<string> {
  const offline = new Set(
    machines
      .filter((machine) => macBlock(machine, serverNow) === MacBlock.Offline)
      .map((machine) => machine.machineId),
  );
  const known = new Set(machines.map((machine) => machine.machineId));
  for (const machineId of seenMachineIds) {
    if (!known.has(machineId)) offline.add(machineId);
  }
  return offline;
}

/**
 * Whether a Mac's agent closes the window on Dismiss.
 * @param agentVersion - The agent's reported version, if any.
 * @returns True for an agent at or past the version that closes windows.
 */
export function dismissClosesWindow(agentVersion: string | undefined): boolean {
  return !isOlderThan(agentVersion, DISMISS_MIN_AGENT_VERSION);
}
