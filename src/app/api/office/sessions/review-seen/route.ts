import type { AnyBulkWriteOperation } from "mongodb";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { reviewSeenRequestSchema } from "@/shared/session";

/**
 * The owner moves one or more Review or Waiting for you employees to Idle; an Idle the owner moved to Review goes back to that Idle.
 * @param request - The request carrying the Review and Waiting for you employees the owner saw.
 * @returns How many were marked (fewer than sent is normal: those rows had already left that state); 401 when not the owner, 400 for a malformed body.
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
    items.flatMap(
      ({ machineId, sessionId, stateSince }): AnyBulkWriteOperation[] => [
        {
          updateOne: {
            // Only the Review or Waiting for you the owner saw; a row that moved on keeps its state
            filter: {
              machineId,
              sessionId,
              state: { $in: ["review", "waitingForYou"] },
              stateSince: new Date(stateSince),
            },
            update: {
              $set: { reviewSeenAt: new Date(stateSince) },
              // The database clock times the move, so a Mac's clock never enters
              $currentDate: { reviewClearedAt: true, changedAt: true },
            },
          },
        },
        {
          updateOne: {
            // An Idle the owner moved to Review goes back to that same Idle
            filter: {
              machineId,
              sessionId,
              state: "idle",
              stateSince: new Date(stateSince),
              reviewRaisedAt: new Date(stateSince),
            },
            update: {
              $unset: { reviewRaisedAt: "" },
              $currentDate: { changedAt: true },
            },
          },
        },
      ],
    ),
  );
  return Response.json({ marked: result.modifiedCount });
}
