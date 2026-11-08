import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import {
  CHANGES_OVERLAP_MS,
  type ChangesResponse,
  type SessionDto,
  type StepDto,
} from "@/shared/session";

interface SessionRow {
  machineId: string;
  machineName: string;
  sessionId: string;
  cwd: string;
  startCwd?: string;
  /** `waiting` is the legacy name of the finished-turn state. */
  state: SessionDto["state"] | "waiting";
  startedAt: Date;
  endedAt?: Date;
  bridgeSessionId?: string;
  deskName?: string;
  recentSteps?: Array<Omit<StepDto, "startedAt"> & { startedAt: Date }>;
  runningSteps?: Array<{ text: string; startedAt: Date }>;
  currentTodo?: string | null;
  tags?: Array<{ name: string; key: string; parent?: string }>;
  hadPrompt?: boolean;
  changedAt: Date;
}

interface FolderDocument {
  machineId: string;
  path: string;
  companyMode: boolean;
  firstSeenAt: Date;
}

interface MachineRow {
  machineId: string;
  machineName: string;
  lastSeenAt: Date;
}

/**
 * Converts a stored session to what the browser gets; ended sessions carry no steps.
 * @param row - The stored session.
 * @returns The session as sent.
 */
function toDto(row: SessionRow): SessionDto {
  const live = !row.endedAt;
  return {
    machineId: row.machineId,
    machineName: row.machineName,
    sessionId: row.sessionId,
    cwd: row.cwd,
    startCwd: row.startCwd ?? row.cwd,
    state: row.state === "waiting" ? "idle" : row.state,
    startedAt: row.startedAt.toISOString(),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    ...(row.deskName ? { deskName: row.deskName } : {}),
    ...(row.bridgeSessionId ? { bridgeSessionId: row.bridgeSessionId } : {}),
    ...(row.recentSteps?.length
      ? {
          recentSteps: row.recentSteps.map((step) => ({
            ...step,
            startedAt: step.startedAt.toISOString(),
          })),
        }
      : {}),
    ...(live && row.runningSteps?.length
      ? {
          runningSteps: row.runningSteps.map((step) => ({
            ...step,
            startedAt: step.startedAt.toISOString(),
          })),
        }
      : {}),
    ...(live && row.currentTodo ? { currentTodo: row.currentTodo } : {}),
    ...(row.tags?.length
      ? {
          tags: row.tags.map(({ name, key, parent }) => ({
            name,
            key,
            ...(parent !== undefined ? { parent } : {}),
          })),
        }
      : {}),
    ...(row.hadPrompt === undefined ? {} : { hadPrompt: row.hadPrompt }),
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
    })),
    folders: folders.map(({ machineId, path, companyMode }) => ({
      machineId,
      path,
      companyMode,
    })),
    cursor: cursor.toISOString(),
    serverNow: new Date().toISOString(),
  };
  return Response.json(body);
}
