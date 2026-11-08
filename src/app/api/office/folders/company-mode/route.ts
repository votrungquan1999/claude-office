import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { setCompanyModeRequestSchema } from "@/shared/folders";

/**
 * The owner switches company mode on or off for one folder of one Mac.
 * @param request - The request carrying the Mac, the folder and the new value.
 * @returns 200 once stored, 401 when not the owner, 400 for a malformed body.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = setCompanyModeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, path, companyMode } = body.data;
  const db = await getDb();
  // A child folder promoted by a switch-off may have no record yet.
  await db
    .collection("folders")
    .updateOne(
      { machineId, path },
      { $set: { companyMode }, $setOnInsert: { firstSeenAt: new Date() } },
      { upsert: true },
    );
  return Response.json({ companyMode });
}
