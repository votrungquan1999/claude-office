import { getDb } from "@/db/mongo";
import { MacBlock, macBlock } from "@/office/offline";
import type { MachineDto } from "@/shared/session";

interface MachineRow {
  machineId: string;
  machineName: string;
  lastSeenAt: Date;
  agentVersion?: string;
}

const REFUSALS: Record<MacBlock, string> = {
  [MacBlock.Offline]: "That Mac is offline.",
  [MacBlock.Outdated]: "Update this Mac's agent.",
};

/**
 * Refuses an order for a Mac that cannot take it; hire, wake and dismiss all ask this.
 * @param machineId - The Mac the order is for.
 * @returns A 409 response with the reason, or undefined when the Mac can take orders.
 */
export async function refuseUnlessMacOnline(
  machineId: string,
): Promise<Response | undefined> {
  const row = await (await getDb())
    .collection<MachineRow>("machines")
    .findOne({ machineId });
  const machine: MachineDto | undefined = row
    ? {
        machineId: row.machineId,
        machineName: row.machineName,
        lastSeenAt: row.lastSeenAt.toISOString(),
        ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
      }
    : undefined;
  const block = macBlock(machine, new Date().toISOString());
  if (!block) return undefined;
  return Response.json({ error: REFUSALS[block] }, { status: 409 });
}
