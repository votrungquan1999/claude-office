import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/mongo";
import { type ConnectCodeDoc, hashSecret } from "@/lib/connect-codes";

const bodySchema = z.object({ pollSecret: z.string().min(1).max(200) });

/**
 * The Mac polls with its secret; once the owner approved, it receives the connection once.
 * @param request - The request carrying the poll secret.
 * @returns 202 while pending, 200 with the connection once, 404 otherwise.
 */
export async function POST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const db = await getDb();
  const secretHash = hashSecret(body.data.pollSecret);
  const codes = db.collection<ConnectCodeDoc>("connectCodes");
  // Delete and read in one step, so two polls can never both receive the connection.
  const now = new Date();
  const taken = await codes.findOneAndDelete({
    secretHash,
    approved: true,
    expiresAt: { $gt: now },
  });
  if (taken) {
    return Response.json({
      mongodbUri: process.env.MONGODB_URI,
      mongodbDb: process.env.MONGODB_DB,
    });
  }
  if (await codes.findOne({ secretHash, expiresAt: { $gt: now } })) {
    return Response.json({ status: "pending" }, { status: 202 });
  }
  return Response.json({ error: "unknown" }, { status: 404 });
}
