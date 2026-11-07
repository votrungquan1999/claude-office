import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import type { ConnectCodeDoc } from "@/lib/connect-codes";
import { requireOwner } from "@/lib/require-owner";
import {
  approveConnectRequestSchema,
  normalizeUserCode,
} from "@/shared/connect";

/**
 * The owner approves a connect request.
 * @param request - The request carrying the code shown on the owner's screen.
 * @returns 200 when approved, 401 when not the owner, 404 for an unknown or expired code.
 */
export async function POST(request: NextRequest) {
  // The proxy lets the connect API through for the Mac, so this route checks the owner itself.
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = approveConnectRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const db = await getDb();
  const result = await db.collection<ConnectCodeDoc>("connectCodes").updateOne(
    {
      userCode: normalizeUserCode(body.data.userCode),
      expiresAt: { $gt: new Date() },
    },
    { $set: { approved: true } },
  );
  if (result.matchedCount === 0) {
    return Response.json({ error: "unknown code" }, { status: 404 });
  }
  return Response.json({ approved: true });
}
