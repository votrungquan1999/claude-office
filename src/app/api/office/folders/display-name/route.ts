import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { setDisplayNameRequestSchema } from "@/shared/folders";

/**
 * The owner names the company of one folder of one Mac, or puts the folder name back.
 * @param request - The request carrying the Mac, the folder and the new name.
 * @returns 200 once stored, 401 when not the owner, 400 for a malformed body.
 */
export async function POST(request: NextRequest) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = setDisplayNameRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const { machineId, path, displayName } = body.data;
  // A blank name puts the folder name back, so the field is removed rather than stored empty.
  const name = displayName === null || displayName === "" ? null : displayName;
  const db = await getDb();
  // A company folder promoted by a switch-off may have no record yet.
  await db.collection("folders").updateOne(
    { machineId, path },
    {
      ...(name === null
        ? { $unset: { displayName: "" } }
        : { $set: { displayName: name } }),
      $setOnInsert: { companyMode: true, firstSeenAt: new Date() },
    },
    { upsert: true },
  );
  return Response.json({ displayName: name });
}
