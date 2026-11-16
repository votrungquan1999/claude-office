import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { AgentRestartBlock, agentRestartBlock } from "@/office/offline";

interface MachineRow {
  machineId: string;
  machineName: string;
  lastSeenAt: Date;
  agentVersion?: string;
  startedByHand?: boolean;
}

/** The owner's restart request: which Mac's agent. */
const restartAgentRequestSchema = z.object({ machineId: z.string().min(1) });

const REFUSALS: Record<AgentRestartBlock, string> = {
  [AgentRestartBlock.Offline]: "That Mac is offline.",
  [AgentRestartBlock.Outdated]:
    "That Mac's agent is older than 0.5.0; restart it on the Mac.",
  [AgentRestartBlock.StartedByHand]:
    "Started by hand on the Mac; restart it there.",
};

/**
 * The owner asks a Mac's agent to restart: it sets the Mac's restart signal, which the agent reads between orders.
 * @param request - The request carrying the Mac.
 * @returns An empty answer; 401 when not the owner, 400 for a bad body, 409 for an offline Mac, an agent older than 0.5.0 or one started by hand.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = restartAgentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId } = body.data;
  const machines = (await getDb()).collection<MachineRow>("machines");
  const row = await machines.findOne({ machineId });
  const block = agentRestartBlock(
    row
      ? {
          machineId: row.machineId,
          machineName: row.machineName,
          lastSeenAt: row.lastSeenAt.toISOString(),
          ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
          ...(row.startedByHand ? { startedByHand: true as const } : {}),
        }
      : undefined,
    new Date().toISOString(),
  );
  if (block) {
    return Response.json({ error: REFUSALS[block] }, { status: 409 });
  }
  await machines.updateOne({ machineId }, { $set: { restartRequested: true } });
  return Response.json({});
}
