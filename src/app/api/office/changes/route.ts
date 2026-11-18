import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { type SessionRow, toDto } from "@/lib/session-row";
import { CHANGES_OVERLAP_MS, type ChangesResponse } from "@/shared/session";

interface FolderDocument {
  machineId: string;
  path: string;
  companyMode: boolean;
  firstSeenAt: Date;
  existsOnMac?: boolean;
  cliTrusted?: boolean;
  displayName?: string;
}

interface MachineRow {
  machineId: string;
  machineName: string;
  lastSeenAt: Date;
  agentVersion?: string;
  agentCommit?: string;
  agentStartedAt?: Date;
  startedByHand?: boolean;
}

/**
 * The sessions the browser has not seen yet.
 * @param request - The incoming request.
 * @returns The sessions, a cursor and the server's time.
 */
export async function GET(request: NextRequest) {
  // Checked here as well as in the proxy: route tests and direct calls skip the proxy.
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    return Response.json({ error: "invalid since" }, { status: 400 });
  }
  const dayStartParam = request.nextUrl.searchParams.get("dayStart");
  const dayStart = dayStartParam ? new Date(dayStartParam) : undefined;
  if (dayStart && Number.isNaN(dayStart.getTime())) {
    return Response.json({ error: "invalid dayStart" }, { status: 400 });
  }
  const db = await getDb();
  // No cursor: the live sessions, plus today's departures when the browser says when its day began.
  // With one: every change, ended sessions included so the browser can drop them.
  const filter = since
    ? { changedAt: { $gte: new Date(since.getTime() - CHANGES_OVERLAP_MS) } }
    : {
        $or: [
          { endedAt: { $exists: false } },
          ...(dayStart
            ? [{ endedAt: { $gte: dayStart }, hadPrompt: true }]
            : []),
        ],
      };
  const rows = await db
    .collection<SessionRow>("sessions")
    .find(filter)
    .sort({ changedAt: 1 })
    .toArray();
  // A handful of documents, so they ride along on every answer.
  const machines = await db
    .collection<MachineRow>("machines")
    .find({})
    .toArray();
  const folders = await db
    .collection<FolderDocument>("folders")
    .find({})
    .toArray();
  // The cursor never moves back, even when only overlap rows came back.
  const newest = rows.at(-1)?.changedAt;
  const cursor =
    newest && (!since || newest > since) ? newest : (since ?? new Date());
  const body: ChangesResponse = {
    sessions: rows.map(toDto),
    machines: machines.map((machine) => ({
      machineId: machine.machineId,
      machineName: machine.machineName,
      lastSeenAt: machine.lastSeenAt.toISOString(),
      ...(machine.agentVersion ? { agentVersion: machine.agentVersion } : {}),
      ...(machine.agentCommit ? { agentCommit: machine.agentCommit } : {}),
      ...(machine.agentStartedAt
        ? { agentStartedAt: machine.agentStartedAt.toISOString() }
        : {}),
      ...(machine.startedByHand ? { startedByHand: true as const } : {}),
    })),
    folders: folders.map(
      ({
        machineId,
        path,
        companyMode,
        existsOnMac,
        cliTrusted,
        displayName,
      }) => ({
        machineId,
        path,
        companyMode,
        ...(displayName === undefined ? {} : { displayName }),
        ...(existsOnMac === undefined ? {} : { existsOnMac }),
        ...(cliTrusted === undefined ? {} : { cliTrusted }),
      }),
    ),
    cursor: cursor.toISOString(),
    serverNow: new Date().toISOString(),
  };
  return Response.json(body);
}
