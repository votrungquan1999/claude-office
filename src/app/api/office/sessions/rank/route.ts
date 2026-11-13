import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { rankRequestSchema } from "@/shared/session";

/**
 * The owner gives conversations their places in the list.
 * @param request - The request carrying the places.
 * @returns 200 with how many conversations were written; 401 when not the owner, 400 for a malformed body.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = rankRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const db = await getDb();
  // No upsert: a row made here would lack the fields the changes answer needs, and a row that expired must stay gone
  const result = await db.collection("sessions").bulkWrite(
    body.data.items.map(({ machineId, sessionId, rank }) => ({
      updateOne: {
        filter: { machineId, sessionId },
        // The database clock stamps the change, so a web server's clock never enters
        update: { $set: { rank }, $currentDate: { changedAt: true } },
      },
    })),
  );
  return Response.json({ written: result.matchedCount });
}
