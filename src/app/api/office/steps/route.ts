import { ObjectId } from "mongodb";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import type { StepDto, StepsPage } from "@/shared/session";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** `before` is "<startedAt ISO>,<step id>": the last step the browser already has. */
const cursorSchema = z
  .string()
  .regex(/^[^,]+,[0-9a-f]{24}$/)
  .transform((value) => {
    const [at, id] = value.split(",");
    return { startedAt: new Date(at), id: new ObjectId(id) };
  })
  .refine((cursor) => !Number.isNaN(cursor.startedAt.getTime()));

const querySchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
  before: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

interface StepRow {
  _id: ObjectId;
  text: string;
  startedAt: Date;
  durationMs?: number;
  status: StepDto["status"];
}

function cursorOf(row: StepRow): string {
  return `${row.startedAt.toISOString()},${row._id.toHexString()}`;
}

/**
 * A page of one session's older steps.
 * @param request - The incoming request.
 * @returns The steps newest first and a cursor for the next page.
 */
export async function GET(request: NextRequest) {
  // Checked here as well as in the proxy: route tests and direct calls skip the proxy.
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const query = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }
  const { machineId, sessionId, before, limit } = query.data;
  const db = await getDb();
  const rows = await db
    .collection<StepRow>("steps")
    .find({
      machineId,
      sessionId,
      // Several steps can start in the same millisecond, so the id breaks the tie.
      ...(before
        ? {
            $or: [
              { startedAt: { $lt: before.startedAt } },
              { startedAt: before.startedAt, _id: { $lt: before.id } },
            ],
          }
        : {}),
    })
    .sort({ startedAt: -1, _id: -1 })
    // One extra row tells whether another page exists.
    .limit(limit + 1)
    .toArray();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const body: StepsPage = {
    steps: page.map((row) => ({
      id: row._id.toHexString(),
      text: row.text,
      startedAt: row.startedAt.toISOString(),
      ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
      status: row.status,
    })),
    ...(rows.length > limit && last ? { next: cursorOf(last) } : {}),
  };
  return Response.json(body);
}
