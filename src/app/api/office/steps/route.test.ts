import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { stepsPageSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { GET } from "./route";

const OWNER = "owner@example.com";
const T0 = Date.parse("2026-11-08T10:00:00.000Z");

function stepsRequest(
  headers: Headers,
  params: Record<string, string>,
): NextRequest {
  const url = new URL("http://localhost:4710/api/office/steps");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { headers });
}

/** Seeds steps whose start times repeat in pairs, so paging has to break ties by id. */
async function seedSteps(
  sessionId: string,
  count: number,
  label: string,
): Promise<void> {
  const docs = Array.from({ length: count }, (_, i) => ({
    _id: new ObjectId(),
    machineId: "m1",
    sessionId,
    text: `${label} ${i}`,
    startedAt: new Date(T0 + Math.floor(i / 2) * 1000),
    durationMs: 10,
    status: "ok",
    expireAt: new Date(T0 + 7 * 86_400_000),
  }));
  await (await getDb()).collection("steps").insertMany(docs);
}

describe("the older-steps API", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("steps").deleteMany({});
  });

  it("pages a session's steps newest first without skipping or repeating any, and never mixes in another session", async () => {
    // Given 7 steps of one session (start times in pairs) and 4 of another
    await seedSteps("s1", 7, "mine");
    await seedSteps("s2", 4, "other");
    const ask = async (params: Record<string, string>) =>
      stepsPageSchema.parse(
        await (
          await GET(
            stepsRequest(ownerHeaders, {
              machineId: "m1",
              sessionId: "s1",
              ...params,
            }),
          )
        ).json(),
      );

    // When the owner pages three at a time
    const pages = [await ask({ limit: "3" })];
    while (pages.at(-1)?.next) {
      pages.push(
        await ask({ limit: "3", before: pages.at(-1)?.next as string }),
      );
    }

    // Then the pages hold all 7, newest first, each once, and the last has no cursor
    expect(pages.map((p) => p.steps.length)).toEqual([3, 3, 1]);
    const texts = pages.flatMap((p) => p.steps.map((s) => s.text));
    expect(texts).toHaveLength(7);
    expect(new Set(texts)).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6].map((i) => `mine ${i}`)),
    );
    const starts = pages.flatMap((p) => p.steps.map((s) => s.startedAt));
    expect(starts).toEqual([...starts].sort().reverse());
    expect(pages.at(-1)?.next).toBeUndefined();

    // And with no limit given a page holds at most 50
    await seedSteps("s3", 60, "many");
    const big = stepsPageSchema.parse(
      await (
        await GET(
          stepsRequest(ownerHeaders, { machineId: "m1", sessionId: "s3" }),
        )
      ).json(),
    );
    expect(big.steps).toHaveLength(50);
    expect(big.next).toBeDefined();
  });

  it("answers only the owner", async () => {
    // Given a stored step
    await seedSteps("s1", 1, "mine");

    // When a signed-out caller and the owner ask
    const params = { machineId: "m1", sessionId: "s1" };
    const signedOut = await GET(stepsRequest(new Headers(), params));
    const owner = await GET(stepsRequest(ownerHeaders, params));

    // Then only the owner gets steps
    expect(signedOut.status).toBe(401);
    expect(owner.status).toBe(200);
    expect(stepsPageSchema.parse(await owner.json()).steps).toHaveLength(1);
  });
});
