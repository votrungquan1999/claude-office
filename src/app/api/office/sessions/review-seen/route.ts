import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { reviewSeenRequestSchema } from "@/shared/session";

/**
 * The owner has looked at one or more Review employees and moves them to Idle.
 * @param request - The request carrying the Reviews the owner saw.
 * @returns How many were marked (fewer than sent is normal: those rows had already left that Review); 401 when not the owner, 400 for a malformed body.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = reviewSeenRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { items } = body.data;
  const db = await getDb();
  const result = await db.collection("sessions").bulkWrite(
    items.map(({ machineId, sessionId, stateSince }) => ({
      updateOne: {
        // Only the Review the owner saw; a row that moved on keeps its state
        filter: {
          machineId,
          sessionId,
          state: "review",
          stateSince: new Date(stateSince),
        },
        update: {
          $set: { reviewSeenAt: new Date(stateSince) },
          // The database clock times the move, so a Mac's clock never enters
          $currentDate: { reviewClearedAt: true, changedAt: true },
        },
      },
    })),
  );
  return Response.json({ marked: result.modifiedCount });
}
