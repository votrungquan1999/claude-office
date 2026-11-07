import { type Collection, MongoServerError } from "mongodb";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/mongo";
import {
  type ConnectCodeDoc,
  hashSecret,
  newPollSecret,
  newUserCode,
} from "@/lib/connect-codes";
import { readAuthEnv } from "@/lib/env";
import {
  CONNECT_CODE_TTL_MS,
  type CreateConnectResponse,
  createConnectRequestSchema,
  MAX_OPEN_CONNECT_CODES,
} from "@/shared/connect";

const MAX_CODE_ATTEMPTS = 5;

/**
 * Inserts the request under a fresh display code, retrying when another request holds the code.
 * @param codes - The connect-code collection.
 * @param doc - The request without its display code.
 * @returns The display code that was stored.
 */
async function insertWithFreshCode(
  codes: Collection<ConnectCodeDoc>,
  doc: Omit<ConnectCodeDoc, "userCode">,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const userCode = newUserCode();
    try {
      await codes.insertOne({ ...doc, userCode });
      return userCode;
    } catch (error) {
      const duplicate =
        error instanceof MongoServerError && error.code === 11000;
      if (!duplicate || attempt >= MAX_CODE_ATTEMPTS) throw error;
    }
  }
}

/**
 * A Mac asks to be connected; public, because the Mac has no login yet. Nothing is handed out
 * until the owner approves the code in the browser.
 * @param request - The request naming the Mac.
 * @returns The code to show, the secret to poll with, and the link to open.
 */
export async function POST(request: NextRequest) {
  const body = createConnectRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }
  const db = await getDb();
  const codes = db.collection<ConnectCodeDoc>("connectCodes");
  const now = new Date();
  // Public route: the cap bounds how many open requests a stranger can leave behind.
  const open = await codes.countDocuments({ expiresAt: { $gt: now } });
  if (open >= MAX_OPEN_CONNECT_CODES) {
    return Response.json({ error: "too many requests" }, { status: 429 });
  }
  const pollSecret = newPollSecret();
  const userCode = await insertWithFreshCode(codes, {
    secretHash: hashSecret(pollSecret),
    hostname: body.data.hostname,
    approved: false,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
  });
  const response: CreateConnectResponse = {
    userCode,
    pollSecret,
    connectUrl: `${readAuthEnv().BETTER_AUTH_URL}/connect?code=${userCode}`,
  };
  return Response.json(response);
}
