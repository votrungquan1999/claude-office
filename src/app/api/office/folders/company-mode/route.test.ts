import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { sessionHeadersFor, signedCookie } from "@/test/owner-session";
import { useTestAuth } from "@/test/use-test-auth";
import { useTestMongo } from "@/test/use-test-mongo";
import { POST } from "./route";

const OWNER = "owner@example.com";

function post(body: unknown, headers?: Headers): NextRequest {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new NextRequest(
    "http://localhost:4710/api/office/folders/company-mode",
    { method: "POST", headers: merged, body: JSON.stringify(body) },
  );
}

describe("switching company mode", () => {
  useTestMongo();
  useTestAuth(OWNER);

  let ownerHeaders: Headers;
  beforeAll(async () => {
    ownerHeaders = (await sessionHeadersFor(OWNER)) ?? new Headers();
  });
  beforeEach(async () => {
    const folders = (await getDb()).collection("folders");
    await folders.deleteMany({});
    await folders.insertMany([
      {
        machineId: "mac-a",
        path: "/home/q/git-repos",
        companyMode: true,
        firstSeenAt: new Date("2026-11-01T00:00:00Z"),
      },
      {
        machineId: "mac-b",
        path: "/home/q/git-repos",
        companyMode: true,
        firstSeenAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
  });

  const modeOf = async (machineId: string, path: string) =>
    (await getDb())
      .collection("folders")
      .findOne({ machineId, path })
      .then((doc) => doc?.companyMode);

  it("switches one Mac's folder off and leaves the same path on another Mac alone", async () => {
    // When the owner switches the folder off on one Mac
    const response = await POST(
      post(
        { machineId: "mac-a", path: "/home/q/git-repos", companyMode: false },
        ownerHeaders,
      ),
    );

    // Then only that Mac's record changed
    expect(response.status).toBe(200);
    expect(await modeOf("mac-a", "/home/q/git-repos")).toBe(false);
    expect(await modeOf("mac-b", "/home/q/git-repos")).toBe(true);
  });

  it("refuses a signed-out caller and a body that is not a folder switch", async () => {
    // When no owner is signed in
    const refused = await POST(
      post({
        machineId: "mac-a",
        path: "/home/q/git-repos",
        companyMode: false,
      }),
    );

    // Then nothing changes
    expect(refused.status).toBe(401);
    expect(await modeOf("mac-a", "/home/q/git-repos")).toBe(true);

    // And a signed-in stranger is refused too, with the record unchanged
    const db = await getDb();
    const userId = new ObjectId();
    await db.collection("user").insertOne({
      _id: userId,
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection("session").insertOne({
      _id: new ObjectId(),
      token: "stranger-token",
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const stranger = await POST(
      post(
        { machineId: "mac-a", path: "/home/q/git-repos", companyMode: false },
        new Headers({ cookie: await signedCookie("stranger-token") }),
      ),
    );
    expect(stranger.status).toBe(401);
    expect(await modeOf("mac-a", "/home/q/git-repos")).toBe(true);

    // And a body without the flag is a 400 for the owner
    const bad = await POST(
      post({ machineId: "mac-a", path: "/home/q/git-repos" }, ownerHeaders),
    );
    expect(bad.status).toBe(400);
  });

  it("creates the record for a folder that has none and accepts the same value twice", async () => {
    // When the owner switches off a folder no record exists for, twice
    const body = {
      machineId: "mac-a",
      path: "/home/q/git-repos/personal",
      companyMode: false,
    };
    const first = await POST(post(body, ownerHeaders));
    const second = await POST(post(body, ownerHeaders));

    // Then one record exists with the flag off
    expect([first.status, second.status]).toEqual([200, 200]);
    const records = await (await getDb())
      .collection("folders")
      .find({ machineId: "mac-a", path: "/home/q/git-repos/personal" })
      .toArray();
    expect(records).toHaveLength(1);
    expect(records[0]?.companyMode).toBe(false);
  });
});
