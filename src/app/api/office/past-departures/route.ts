import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/mongo";
import { requireOwner } from "@/lib/require-owner";
import { type SessionRow, toDto } from "@/lib/session-row";
import {
  fieldsOf,
  matchEmployee,
  queryWords,
  wordPattern,
} from "@/shared/employee-search";
import type { PastDeparturesResponse, SessionDto } from "@/shared/session";

/** Enough to find the one the owner remembers; a longer list is a sign to type more. */
const MAX_RESULTS = 50;
/** The stored fields behind `fieldsOf`; an ended session's steps are its recent ones. */
const SEARCHED_FIELDS = [
  "ownerName",
  "deskName",
  "cwd",
  "tabName",
  "request",
  "recentSteps.text",
];

const querySchema = z.object({
  q: z.string().trim().min(1),
  /** The browser's local midnight; departures from then on are already in its list. */
  before: z.iso.datetime({ offset: true }).transform((at) => new Date(at)),
});

/**
 * Searches the employees that went home before today.
 * @param request - The incoming request, with the query and the browser's day start.
 * @returns The matching sessions, newest departure first.
 */
export async function GET(request: NextRequest) {
  // Checked here as well as in the proxy: route tests and direct calls skip the proxy.
  if (!(await requireOwner(request.headers))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }
  const { q, before } = parsed.data;
  const words = queryWords(q);
  // A query of lone accent marks folds to nothing, and the database refuses an empty `$and`
  if (words.length === 0) {
    return Response.json({ sessions: [] } satisfies PastDeparturesResponse);
  }
  const rows = (await getDb())
    .collection<SessionRow>("sessions")
    .find({
      endedAt: { $lt: before },
      hadPrompt: true,
      // The database narrows a year of departures to rows holding every word somewhere; matchEmployee decides
      $and: words.map((word) => ({
        $or: SEARCHED_FIELDS.map((field) => ({
          [field]: { $regex: wordPattern(word) },
        })),
      })),
    })
    // `_id` breaks ties so equal end times keep one order
    .sort({ endedAt: -1, _id: -1 });
  const sessions: SessionDto[] = [];
  for await (const row of rows) {
    const session = toDto(row);
    if (matchEmployee(q, fieldsOf(session))) sessions.push(session);
    if (sessions.length === MAX_RESULTS) break;
  }
  const body: PastDeparturesResponse = { sessions };
  return Response.json(body);
}
