import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import {
  type CommandDocument,
  type CommandKind,
  CommandStatus,
  UNCLAIMED_ORDER_TTL_MS,
} from "@/shared/commands";

interface NewOrder {
  machineId: string;
  kind: CommandKind;
  sessionId: string;
  folder: string;
  firstMessage?: string;
}

/**
 * Writes a pending order for a Mac's agent to pick up.
 * @param db - The database.
 * @param order - What the agent is to do and for which session.
 * @returns The new order's id.
 */
export async function insertOrder(db: Db, order: NewOrder): Promise<string> {
  const orderId = randomUUID();
  // Literals so a value starting with "$" is never read as a field path by the pipeline.
  await db.collection<CommandDocument>("commands").updateOne(
    { _id: orderId },
    [
      {
        $set: {
          machineId: { $literal: order.machineId },
          kind: order.kind,
          status: CommandStatus.Pending,
          sessionId: { $literal: order.sessionId },
          folder: { $literal: order.folder },
          ...(order.firstMessage !== undefined && {
            firstMessage: { $literal: order.firstMessage },
          }),
          // The database clock, so the 30 s pickup rule never depends on this server's.
          createdAt: "$$NOW",
          expireAt: { $add: ["$$NOW", UNCLAIMED_ORDER_TTL_MS] },
        },
      },
    ],
    { upsert: true },
  );
  return orderId;
}
