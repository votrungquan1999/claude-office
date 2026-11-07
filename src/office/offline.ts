import type { MachineDto } from "@/shared/session";

/** Three missed heartbeats (one a minute). */
const OFFLINE_AFTER_MS = 180_000;

/**
 * The Macs that have gone quiet.
 * @param machines - Every Mac with its last heartbeat.
 * @param serverNow - The server's time sent with the same answer; never the browser's clock.
 * @returns The ids of Macs whose last heartbeat is older than the offline window.
 */
export function offlineMachineIds(
  machines: MachineDto[],
  serverNow: string,
): Set<string> {
  const now = Date.parse(serverNow);
  return new Set(
    machines
      .filter(
        (machine) => now - Date.parse(machine.lastSeenAt) > OFFLINE_AFTER_MS,
      )
      .map((machine) => machine.machineId),
  );
}
