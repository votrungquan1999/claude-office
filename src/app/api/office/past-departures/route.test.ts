import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { pastDeparturesResponseSchema } from "@/shared/session";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { GET } from "./route";

const OWNER = "owner@example.com";
const DAY_START = new Date("2026-11-17T00:00:00.000+07:00");
const HOUR = 3_600_000;

function searchRequest(headers: Headers, q: string): NextRequest {
  const url = new URL("http://localhost:4710/api/office/past-departures");
  url.searchParams.set("q", q);
  url.searchParams.set("before", DAY_START.toISOString());
  return new NextRequest(url, { headers });
}

/** Writes a session straight into the database; no `endedAt` keeps it live. */
async function seedSession(
  sessionId: string,
  fields: {
    request?: string;
    endedAt?: Date;
    hadPrompt?: boolean;
    /** Any other stored field, such as names or steps. */
    more?: Record<string, unknown>;
  },
): Promise<void> {
  await (await getDb()).collection("sessions").insertOne({
    machineId: "m1",
    machineName: "Mac",
    sessionId,
    cwd: "/work",
    state: fields.endedAt ? "wentHome" : "idle",
    startedAt: new Date(DAY_START.getTime() - 30 * 24 * HOUR),
    changedAt: fields.endedAt ?? DAY_START,
    hadPrompt: fields.hadPrompt ?? true,
    ...(fields.request ? { request: fields.request } : {}),
    ...(fields.endedAt ? { endedAt: fields.endedAt } : {}),
    ...fields.more,
  });
}

describe("the past departures search API", () => {
  useTestMongo();

  let ownerHeaders: Headers;

  useTestAuth(OWNER);

  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    await (await getDb()).collection("sessions").deleteMany({});
  });

  it("finds employees that went home before today, newest first", async () => {
    // Given two matching employees that went home on earlier days
    await seedSession("last-week", {
      request: "Fix the invoice export",
      endedAt: new Date(DAY_START.getTime() - 6 * 24 * HOUR),
    });
    await seedSession("yesterday", {
      request: "Invoice totals are wrong",
      endedAt: new Date(DAY_START.getTime() - 5 * HOUR),
    });
    // And matching ones the browser already has or never shows
    await seedSession("today", {
      request: "Invoice layout",
      endedAt: new Date(DAY_START.getTime() + HOUR),
    });
    await seedSession("live", { request: "Invoice emails" });
    await seedSession("no-prompt", {
      request: "Invoice draft",
      endedAt: new Date(DAY_START.getTime() - 2 * HOUR),
      hadPrompt: false,
    });
    // And one that does not match
    await seedSession("other", {
      request: "Rename the payroll job",
      endedAt: new Date(DAY_START.getTime() - 3 * HOUR),
    });

    // When the owner searches for "invoice"
    const body = pastDeparturesResponseSchema.parse(
      await (await GET(searchRequest(ownerHeaders, "invoice"))).json(),
    );

    // Then only the earlier departures come back, newest first
    expect(body.sessions.map((s) => s.sessionId)).toEqual([
      "yesterday",
      "last-week",
    ]);
  });

  it("sends at most the 50 newest matches", async () => {
    // Given 51 matching employees that went home on earlier days
    for (let i = 1; i <= 51; i++) {
      await seedSession(`s${i}`, {
        request: "Invoice job",
        endedAt: new Date(DAY_START.getTime() - i * HOUR),
      });
    }

    // When the owner searches for them
    const body = pastDeparturesResponseSchema.parse(
      await (await GET(searchRequest(ownerHeaders, "invoice"))).json(),
    );

    // Then the 50 newest come back and the oldest is left out
    expect(body.sessions).toHaveLength(50);
    expect(body.sessions.at(0)?.sessionId).toBe("s1");
    expect(body.sessions.at(-1)?.sessionId).toBe("s50");
  });

  it("reads every field the palette reads, ignoring accents and capitals", async () => {
    // Given earlier departures that each hold the word in a different field
    const step = (text: string, minutesAgo: number) => ({
      id: `step-${text}`,
      text,
      startedAt: new Date(
        DAY_START.getTime() - 48 * HOUR - minutesAgo * 60_000,
      ),
      status: "ok",
    });
    const earlier = (hours: number) =>
      new Date(DAY_START.getTime() - hours * HOUR);
    await seedSession("owner-name", {
      endedAt: earlier(1),
      more: { ownerName: "Zébra helper" },
    });
    await seedSession("desk-name", {
      endedAt: earlier(2),
      more: { deskName: "Fix ZEBRA crossing" },
    });
    await seedSession("folder", {
      endedAt: earlier(3),
      more: { cwd: "/work/zèbra-app" },
    });
    await seedSession("tab", {
      endedAt: earlier(4),
      more: { tabName: "zebra" },
    });
    await seedSession("request", {
      request: "Tìm lỗi Zebra",
      endedAt: earlier(5),
    });
    await seedSession("last-step", {
      endedAt: earlier(6),
      more: { recentSteps: [step("Other", 2), step("Read zebra.md", 1)] },
    });
    // And ones that hold it only in an older step, or inside a word
    await seedSession("older-step", {
      endedAt: earlier(7),
      more: { recentSteps: [step("Read zebra.md", 2), step("Other", 1)] },
    });
    await seedSession("inside-word", {
      request: "Rename unzebra",
      endedAt: earlier(8),
    });

    // When the owner searches for "zebra"
    const byWord = pastDeparturesResponseSchema.parse(
      await (await GET(searchRequest(ownerHeaders, "zebra"))).json(),
    );

    // Then every field the palette reads matches, and an older step or the inside of a word does not
    expect(byWord.sessions.map((s) => s.sessionId)).toEqual([
      "owner-name",
      "desk-name",
      "folder",
      "tab",
      "request",
      "last-step",
    ]);

    // When the owner types two words without accents
    const twoWords = pastDeparturesResponseSchema.parse(
      await (await GET(searchRequest(ownerHeaders, "TIM loi"))).json(),
    );

    // Then the accented request still matches
    expect(twoWords.sessions.map((s) => s.sessionId)).toEqual(["request"]);
  });
});
