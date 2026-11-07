import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import {
  CHANGES_OVERLAP_MS,
  type ChangesResponse,
  type SessionDto,
} from "@/shared/session";

interface SessionRow {
  machineId: string;
  machineName: string;
  sessionId: string;
  cwd: string;
  state: SessionDto["state"];
  startedAt: Date;
  endedAt?: Date;
  bridgeSessionId?: string;
  changedAt: Date;
}

function toDto(row: SessionRow): SessionDto {
  return {
    machineId: row.machineId,
    machineName: row.machineName,
    sessionId: row.sessionId,
    cwd: row.cwd,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    ...(row.bridgeSessionId ? { bridgeSessionId: row.bridgeSessionId } : {}),
    changedAt: row.changedAt.toISOString(),
  };
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
  const db = await getDb();
  // No cursor: the live sessions. With one: every change, ended sessions included so the browser can drop them.
  const filter = since
    ? { changedAt: { $gte: new Date(since.getTime() - CHANGES_OVERLAP_MS) } }
    : { endedAt: { $exists: false } };
  const rows = await db
    .collection<SessionRow>("sessions")
    .find(filter)
    .sort({ changedAt: 1 })
    .toArray();
  // The cursor never moves back, even when only overlap rows came back.
  const newest = rows.at(-1)?.changedAt;
  const cursor =
    newest && (!since || newest > since) ? newest : (since ?? new Date());
  const body: ChangesResponse = {
    sessions: rows.map(toDto),
    cursor: cursor.toISOString(),
    serverNow: new Date().toISOString(),
  };
  return Response.json(body);
}
