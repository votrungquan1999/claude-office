import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import {
  type CommandDocument,
  type OrderStatus,
  orderStatusSchema,
} from "@/shared/commands";

/**
 * The owner reads how one order is doing; the message is never part of the answer.
 * @param request - The incoming request.
 * @param context - The route parameters holding the order id.
 * @returns The status, reason and age; 401 when not the owner, 404 when the order is gone.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const [row] = await (await getDb())
    .collection<CommandDocument>("commands")
    .aggregate([
      { $match: { _id: id } },
      // The age is measured by the database clock that stamped `createdAt`.
      {
        $project: {
          _id: 0,
          status: 1,
          reason: 1,
          ageMs: { $subtract: ["$$NOW", "$createdAt"] },
        },
      },
    ])
    .toArray();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const answer: OrderStatus = orderStatusSchema.parse(row);
  return Response.json(answer);
}
