import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { ownerNameRequestSchema } from "@/shared/session";

/**
 * The owner names one employee; an empty name takes the owner's name away.
 * @param request - The request carrying the employee and its new name.
 * @returns 200 once stored; 401 when not the owner, 400 for a malformed body, 404 when the employee has no row.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = ownerNameRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, sessionId, name } = body.data;
  // One line: the name is drawn as a one-line label
  const oneLine = name.replace(/\s+/g, " ").trim();
  const db = await getDb();
  // No upsert: a row made here would lack the fields the changes answer needs
  const result = await db.collection("sessions").updateOne(
    { machineId, sessionId },
    {
      ...(oneLine
        ? { $set: { ownerName: oneLine } }
        : { $unset: { ownerName: "" } }),
      // The database clock stamps the change, so a web server's clock never enters
      $currentDate: { changedAt: true },
    },
  );
  if (result.matchedCount === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({});
}
