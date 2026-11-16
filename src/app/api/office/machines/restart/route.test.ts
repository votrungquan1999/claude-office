import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { sessionHeadersFor } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest("http://localhost:4710/api/office/machines/restart", {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

describe("asking a Mac's agent to restart", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const db = await getDb();
    await db.collection("machines").deleteMany({});
    await db.collection("machines").insertMany([
      {
        machineId: "mac-up",
        machineName: "Up",
        lastSeenAt: new Date(),
        agentVersion: "0.5.0",
        startedByHand: false,
      },
      {
        machineId: "mac-quiet",
        machineName: "Quiet",
        lastSeenAt: new Date(Date.now() - 10 * 60_000),
        agentVersion: "0.5.0",
      },
      {
        machineId: "mac-old",
        machineName: "Old",
        lastSeenAt: new Date(),
        agentVersion: "0.4.0",
      },
      {
        machineId: "mac-hand",
        machineName: "Hand",
        lastSeenAt: new Date(),
        agentVersion: "0.5.0",
        startedByHand: true,
      },
    ]);
  });

  const signalOf = async (machineId: string) =>
    (await (await getDb()).collection("machines").findOne({ machineId }))
      ?.restartRequested;

  it("turns the signal on for an online Mac whose launchd-run agent is on 0.5.0", async () => {
    // When the owner asks Up's agent to restart
    const response = await POST(post({ machineId: "mac-up" }, ownerHeaders));

    // Then Up's signal is on
    expect(response.status).toBe(200);
    expect(await signalOf("mac-up")).toBe(true);
  });

  it("refuses an offline Mac, an unknown one, an agent older than 0.5.0 and one started by hand, and sets no signal", async () => {
    // When the owner asks each of them
    const answers = await Promise.all(
      ["mac-quiet", "mac-gone", "mac-old", "mac-hand"].map(async (id) => {
        const response = await POST(post({ machineId: id }, ownerHeaders));
        return { status: response.status, body: await response.json() };
      }),
    );

    // Then each is refused with its reason and no signal is on
    expect(answers).toEqual([
      { status: 409, body: { error: "That Mac is offline." } },
      { status: 409, body: { error: "That Mac is offline." } },
      {
        status: 409,
        body: {
          error: "That Mac's agent is older than 0.5.0; restart it on the Mac.",
        },
      },
      {
        status: 409,
        body: { error: "Started by hand on the Mac; restart it there." },
      },
    ]);
    for (const id of ["mac-quiet", "mac-old", "mac-hand"]) {
      expect(await signalOf(id)).toBeUndefined();
    }
  });

  it("refuses anyone but the owner and a body without a Mac", async () => {
    // When a stranger asks, and the owner sends no Mac
    const stranger = await POST(post({ machineId: "mac-up" }));
    const empty = await POST(post({}, ownerHeaders));

    // Then they are refused and no signal is on
    expect(stranger.status).toBe(401);
    expect(empty.status).toBe(400);
    expect(await signalOf("mac-up")).toBeUndefined();
  });
});
