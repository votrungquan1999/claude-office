import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { refuseUnlessMacOnline } from "@/lib/require-online-mac";
import { requireOwner } from "@/lib/require-owner";
import {
  type CommandDocument,
  CommandKind,
  CommandStatus,
  NOT_SENT_AFTER_MS,
  UNCLAIMED_ORDER_TTL_MS,
  type WakeResponse,
  wakeRequestSchema,
} from "@/shared/commands";

interface SessionRow {
  machineId: string;
  sessionId: string;
  state: string;
  cwd: string;
  startCwd?: string;
  notRunning?: true;
  waitingAtMac?: true;
  starting?: true;
}

/**
 * The owner wakes an employee that went home or is not running: an order for its Mac's agent to resume the conversation.
 * @param request - The request carrying the Mac and the session.
 * @returns The order and session ids; 401 when not the owner, 400 for a bad body or a session that is not went home or not running, 409 for a Mac that cannot take orders or a wake for this employee already on its way.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = wakeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, sessionId } = body.data;
  const refusal = await refuseUnlessMacOnline(machineId);
  if (refusal) return refusal;
  const db = await getDb();
  const row = await db
    .collection<SessionRow>("sessions")
    .findOne({ machineId, sessionId });
  // The agent's own check is the real gate; this one keeps orders off sessions that plainly run.
  const wakeable =
    row &&
    !row.waitingAtMac &&
    !row.starting &&
    (row.state === "wentHome" || row.notRunning === true);
  if (!wakeable) {
    return Response.json(
      { error: "that employee cannot be woken" },
      { status: 400 },
    );
  }
  const orders = db.collection<CommandDocument>("commands");
  // A pending order older than the pickup window never runs, so it no longer blocks a new wake.
  const onItsWay = await orders.countDocuments({
    machineId,
    sessionId,
    kind: CommandKind.Wake,
    $or: [
      { status: CommandStatus.Claimed },
      {
        status: CommandStatus.Pending,
        $expr: {
          $gte: ["$createdAt", { $subtract: ["$$NOW", NOT_SENT_AFTER_MS] }],
        },
      },
    ],
  });
  if (onItsWay > 0) {
    return Response.json(
      { error: "a wake for this employee is already on its way" },
      { status: 409 },
    );
  }
  const orderId = randomUUID();
  await orders.updateOne(
    { _id: orderId },
    [
      {
        $set: {
          machineId: { $literal: machineId },
          kind: CommandKind.Wake,
          status: CommandStatus.Pending,
          sessionId: { $literal: sessionId },
          // `--resume` finds the transcript under the folder the session started in.
          folder: { $literal: row.startCwd ?? row.cwd },
          // The database clock, so the 30 s pickup rule never depends on this server's.
          createdAt: "$$NOW",
          expireAt: { $add: ["$$NOW", UNCLAIMED_ORDER_TTL_MS] },
        },
      },
    ],
    { upsert: true },
  );
  const answer: WakeResponse = { orderId, sessionId };
  return Response.json(answer);
}
