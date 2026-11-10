import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { refuseUnlessMacOnline } from "@/lib/require-online-mac";
import { requireOwner } from "@/lib/require-owner";
import {
  type CommandDocument,
  CommandKind,
  CommandStatus,
  type HireResponse,
  hireRequestSchema,
  UNCLAIMED_ORDER_TTL_MS,
} from "@/shared/commands";

interface FolderRow {
  machineId: string;
  path: string;
  existsOnMac?: boolean;
}

/**
 * The owner hires an employee: an order for a Mac's agent to open Claude Code in a folder.
 * @param request - The request carrying the Mac, one of its known folders and the first message.
 * @returns The order and session ids; 401 when not the owner, 400 for a bad body, a message over the limit or an unknown folder, 409 for a Mac that cannot take orders.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = hireRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    const tooLong = body.error.issues.some(
      (issue) => issue.code === "too_big" && issue.path[0] === "firstMessage",
    );
    return Response.json(
      { error: tooLong ? "message too long" : "invalid request" },
      { status: 400 },
    );
  }
  const { machineId, folder, firstMessage } = body.data;
  const refusal = await refuseUnlessMacOnline(machineId);
  if (refusal) return refusal;
  const db = await getDb();
  // Only folders the Mac has already shown the office, and that still exist there.
  const known = await db
    .collection<FolderRow>("folders")
    .findOne({ machineId, path: folder });
  if (!known || known.existsOnMac === false) {
    return Response.json({ error: "unknown folder" }, { status: 400 });
  }
  const orderId = randomUUID();
  const sessionId = randomUUID();
  // Literals so a message starting with "$" is never read as a field path by the pipeline.
  await db.collection<CommandDocument>("commands").updateOne(
    { _id: orderId },
    [
      {
        $set: {
          machineId: { $literal: machineId },
          kind: CommandKind.Hire,
          status: CommandStatus.Pending,
          sessionId,
          folder: { $literal: folder },
          firstMessage: { $literal: firstMessage },
          // The database clock, so the 30 s pickup rule never depends on this server's.
          createdAt: "$$NOW",
          expireAt: { $add: ["$$NOW", UNCLAIMED_ORDER_TTL_MS] },
        },
      },
    ],
    { upsert: true },
  );
  const answer: HireResponse = { orderId, sessionId };
  return Response.json(answer);
}
