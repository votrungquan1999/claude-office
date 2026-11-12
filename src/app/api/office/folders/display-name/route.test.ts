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
    "http://localhost:4710/api/office/folders/display-name",
    { method: "POST", headers: merged, body: JSON.stringify(body) },
  );
}

describe("naming a company", () => {
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
        path: "/home/q/harbor-labs",
        companyMode: true,
        firstSeenAt: new Date("2026-11-01T00:00:00Z"),
      },
      {
        machineId: "mac-b",
        path: "/home/q/harbor-labs",
        companyMode: true,
        firstSeenAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
  });

  const recordOf = async (machineId: string, path: string) =>
    (await getDb()).collection("folders").findOne({ machineId, path });

  it("stores the name on one Mac's folder and leaves the same path on another Mac alone", async () => {
    // When the owner names the folder on one Mac
    const response = await POST(
      post(
        {
          machineId: "mac-a",
          path: "/home/q/harbor-labs",
          displayName: "Harbor",
        },
        ownerHeaders,
      ),
    );

    // Then only that Mac's record carries the name
    expect(response.status).toBe(200);
    expect((await recordOf("mac-a", "/home/q/harbor-labs"))?.displayName).toBe(
      "Harbor",
    );
    expect(
      (await recordOf("mac-b", "/home/q/harbor-labs"))?.displayName,
    ).toBeUndefined();
  });

  it("stores a name of exactly 100 characters", async () => {
    // When the owner saves the longest name allowed
    const longest = "x".repeat(100);
    const response = await POST(
      post(
        {
          machineId: "mac-a",
          path: "/home/q/harbor-labs",
          displayName: longest,
        },
        ownerHeaders,
      ),
    );

    // Then it is stored whole
    expect(response.status).toBe(200);
    expect((await recordOf("mac-a", "/home/q/harbor-labs"))?.displayName).toBe(
      longest,
    );
  });

  it("leaves the fields the agent writes alone when it renames", async () => {
    // Given a record the agent wrote, with company mode off
    const folders = (await getDb()).collection("folders");
    await folders.insertOne({
      machineId: "mac-a",
      path: "/home/q/agent-written",
      companyMode: false,
      existsOnMac: false,
      cliTrusted: true,
      firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    });

    // When the owner names it
    const response = await POST(
      post(
        {
          machineId: "mac-a",
          path: "/home/q/agent-written",
          displayName: "Harbor",
        },
        ownerHeaders,
      ),
    );

    // Then only the name is set
    expect(response.status).toBe(200);
    const record = await recordOf("mac-a", "/home/q/agent-written");
    expect(record?.displayName).toBe("Harbor");
    expect(record?.companyMode).toBe(false);
    expect(record?.existsOnMac).toBe(false);
    expect(record?.cliTrusted).toBe(true);
  });

  it("refuses a signed-out caller, a stranger, and a body that is not a name", async () => {
    const body = {
      machineId: "mac-a",
      path: "/home/q/harbor-labs",
      displayName: "Harbor",
    };

    // When no owner is signed in
    const refused = await POST(post(body));

    // Then nothing is stored
    expect(refused.status).toBe(401);

    // And a signed-in stranger is refused too
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
      post(body, new Headers({ cookie: await signedCookie("stranger-token") })),
    );
    expect(stranger.status).toBe(401);

    // And the owner gets a 400 for a missing name and for 101 characters
    const missing = await POST(
      post({ machineId: "mac-a", path: "/home/q/harbor-labs" }, ownerHeaders),
    );
    const tooLong = await POST(
      post({ ...body, displayName: "x".repeat(101) }, ownerHeaders),
    );
    expect([missing.status, tooLong.status]).toEqual([400, 400]);
    expect(
      (await recordOf("mac-a", "/home/q/harbor-labs"))?.displayName,
    ).toBeUndefined();
  });

  it("creates the record, with company mode on, for a folder that has none", async () => {
    // When the owner names a folder no record exists for
    const response = await POST(
      post(
        {
          machineId: "mac-a",
          path: "/home/q/harbor-labs/api",
          displayName: "  Billing  ",
        },
        ownerHeaders,
      ),
    );

    // Then a record exists with the trimmed name and company mode on
    expect(response.status).toBe(200);
    const record = await recordOf("mac-a", "/home/q/harbor-labs/api");
    expect(record?.displayName).toBe("Billing");
    expect(record?.companyMode).toBe(true);
  });
});
