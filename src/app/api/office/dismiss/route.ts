import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { insertOrder } from "@/lib/insert-order";
import { refuseUnlessMacOnline } from "@/lib/require-online-mac";
import { requireOwner } from "@/lib/require-owner";
import {
  CommandKind,
  dismissRequestSchema,
  type OrderResponse,
} from "@/shared/commands";

interface SessionRow {
  kept?: "hired" | "woken";
  cwd: string;
  startCwd?: string;
}

/**
 * The owner dismisses a hired or woken employee: an order for its Mac's agent to stop keeping the desk, and to end its running conversation only when the request says `endRunning`.
 * @param request - The request carrying the Mac and the session.
 * @returns The order and session ids; 401 when not the owner, 400 for a bad body or a session that is not kept, 409 for a Mac that cannot take orders.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = dismissRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, sessionId, endRunning } = body.data;
  const refusal = await refuseUnlessMacOnline(machineId);
  if (refusal) return refusal;
  const db = await getDb();
  const row = await db
    .collection<SessionRow>("sessions")
    .findOne({ machineId, sessionId });
  // A session that is not kept has nothing to dismiss.
  if (!row?.kept) {
    return Response.json(
      { error: "that employee cannot be dismissed" },
      { status: 400 },
    );
  }
  const orderId = await insertOrder(db, {
    machineId,
    kind: CommandKind.Dismiss,
    sessionId,
    folder: row.startCwd ?? row.cwd,
    endRunning,
  });
  const answer: OrderResponse = { orderId, sessionId };
  return Response.json(answer);
}
