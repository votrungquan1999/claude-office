import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { insertOrder } from "@/lib/insert-order";
import { refuseUnlessMacOnline } from "@/lib/require-online-mac";
import { requireOwner } from "@/lib/require-owner";
import { takesBlankHire } from "@/office/offline";
import {
  CommandKind,
  hireRequestSchema,
  type OrderResponse,
} from "@/shared/commands";

interface MachineVersionRow {
  machineId: string;
  agentVersion?: string;
}

interface FolderRow {
  machineId: string;
  path: string;
  existsOnMac?: boolean;
}

/**
 * The owner hires an employee: an order for a Mac's agent to open Claude Code in a folder.
 * @param request - The request carrying the Mac, one of its known folders and the first message, or `blank: true` for none.
 * @returns The order and session ids; 401 when not the owner, 400 for a bad body, a message over the limit or an unknown folder, 409 for a Mac that cannot take orders or a blank hire to an agent older than 0.5.0.
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
  const { machineId, folder } = body.data;
  const firstMessage =
    "firstMessage" in body.data ? body.data.firstMessage : undefined;
  const refusal = await refuseUnlessMacOnline(machineId);
  if (refusal) return refusal;
  const db = await getDb();
  if (firstMessage === undefined) {
    // An older agent would fail the order as not valid; saying why here is clearer.
    const machine = await db
      .collection<MachineVersionRow>("machines")
      .findOne({ machineId });
    if (!takesBlankHire(machine?.agentVersion)) {
      return Response.json(
        { error: "Update this Mac's agent to hire with no first message." },
        { status: 409 },
      );
    }
  }
  // Only folders the Mac has already shown the office, and that still exist there.
  const known = await db
    .collection<FolderRow>("folders")
    .findOne({ machineId, path: folder });
  if (!known || known.existsOnMac === false) {
    return Response.json({ error: "unknown folder" }, { status: 400 });
  }
  const sessionId = randomUUID();
  const orderId = await insertOrder(db, {
    machineId,
    kind: CommandKind.Hire,
    sessionId,
    folder,
    firstMessage,
  });
  const answer: OrderResponse = { orderId, sessionId };
  return Response.json(answer);
}
