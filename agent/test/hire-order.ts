import { NextRequest } from "next/server";
import { POST as dismiss } from "@/app/api/office/dismiss/route";
import { POST as hire } from "@/app/api/office/hire/route";
import { POST as wake } from "@/app/api/office/wake/route";
import { getDb } from "@/db/mongo";
import { orderResponseSchema } from "@/shared/commands";
import { sessionHeadersFor } from "@/test/owner-session";
import type { MacHarness } from "./mac-harness";

const OWNER = "owner@example.com";
const MACHINE_ID = "machine-air";

/**
 * The owner's hire request, as the browser sends it.
 * @param machineId - The Mac to hire on.
 * @param folder - One of the Mac's known folders.
 * @param message - The first message.
 * @returns The route's response and, when accepted, its parsed answer.
 */
export async function postHire(
  machineId: string,
  folder: string,
  message: string,
) {
  const headers = new Headers((await sessionHeadersFor(OWNER)) ?? undefined);
  headers.set("content-type", "application/json");
  const response = await hire(
    new NextRequest("http://localhost:4710/api/office/hire", {
      method: "POST",
      headers,
      body: JSON.stringify({ machineId, folder, firstMessage: message }),
    }),
  );
  return {
    response,
    body: response.ok
      ? orderResponseSchema.parse(await response.json())
      : undefined,
  };
}

/**
 * The owner hires into a new folder of a Mac and the agent opens the window.
 * @param mac - A Mac started as `machine-air` by the harness.
 * @param message - The first message.
 * @returns The folder hired into and the new session's id.
 */
export async function hireOnto(
  mac: Awaited<ReturnType<MacHarness["setUpMac"]>>,
  message = "Hello",
) {
  const folder = mac.fake.makeFolder("app");
  await (await getDb()).collection("folders").insertOne({
    machineId: MACHINE_ID,
    path: folder,
    companyMode: true,
    firstSeenAt: new Date(),
  });
  const { body } = await postHire(MACHINE_ID, folder, message);
  await mac.agent.pollCommands();
  return { folder, sessionId: body?.sessionId ?? "" };
}

/**
 * The owner's wake request, as the browser sends it.
 * @param machineId - The Mac the session belongs to.
 * @param sessionId - The session to wake.
 * @returns The route's response and, when accepted, its parsed answer.
 */
export async function postWake(machineId: string, sessionId: string) {
  const headers = new Headers((await sessionHeadersFor(OWNER)) ?? undefined);
  headers.set("content-type", "application/json");
  const response = await wake(
    new NextRequest("http://localhost:4710/api/office/wake", {
      method: "POST",
      headers,
      body: JSON.stringify({ machineId, sessionId }),
    }),
  );
  return {
    response,
    body: response.ok
      ? orderResponseSchema.parse(await response.json())
      : undefined,
  };
}

/**
 * The owner's dismiss request, as the browser sends it.
 * @param machineId - The Mac the session belongs to.
 * @param sessionId - The kept session to dismiss.
 * @param endRunning - Whether the request asks to end a running conversation, as the confirmed pop-up does; false sends the request of a page without the pop-up.
 * @returns The route's response and, when accepted, its parsed answer.
 */
export async function postDismiss(
  machineId: string,
  sessionId: string,
  endRunning = true,
) {
  const headers = new Headers((await sessionHeadersFor(OWNER)) ?? undefined);
  headers.set("content-type", "application/json");
  const response = await dismiss(
    new NextRequest("http://localhost:4710/api/office/dismiss", {
      method: "POST",
      headers,
      body: JSON.stringify(
        endRunning
          ? { machineId, sessionId, endRunning }
          : { machineId, sessionId },
      ),
    }),
  );
  return {
    response,
    body: response.ok
      ? orderResponseSchema.parse(await response.json())
      : undefined,
  };
}
