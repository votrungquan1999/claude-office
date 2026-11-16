import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { moveToReviewRequestSchema } from "@/shared/session";

/**
 * The owner moves one Idle employee to Review.
 * @param request - The request naming the Idle employee the owner saw.
 * @returns How many were marked (0 when that Idle has already moved on); 401 when not the owner, 400 for a malformed body.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = moveToReviewRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, sessionId, stateSince } = body.data;
  const db = await getDb();
  const seen = new Date(stateSince);
  const result = await db.collection("sessions").updateOne(
    {
      machineId,
      sessionId,
      // Only the Idle the owner saw; a row that moved on keeps its state
      $or: [
        { state: "idle", stateSince: seen },
        // A Review or Waiting for you moved to Idle, named by its Idle time or, by a device that has not polled since, its own time
        {
          state: { $in: ["review", "waitingForYou"] },
          $or: [{ reviewClearedAt: seen }, { stateSince: seen }],
          $expr: { $eq: ["$reviewSeenAt", "$stateSince"] },
        },
      ],
    },
    [
      {
        $set: {
          reviewRaisedAt: {
            $cond: [{ $eq: ["$state", "idle"] }, "$stateSince", "$$REMOVE"],
          },
          changedAt: "$$NOW",
        },
      },
      // Taking the Idle mark away is what shows the cleared state again
      { $unset: ["reviewSeenAt", "reviewClearedAt"] },
    ],
  );
  return Response.json({ marked: result.modifiedCount });
}
