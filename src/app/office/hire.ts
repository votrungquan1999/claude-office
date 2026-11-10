import {
  type HireRequest,
  type HireResponse,
  hireResponseSchema,
  MAX_FIRST_MESSAGE_CHARS,
} from "@/shared/commands";

/** Server refusals that are not already plain sentences. */
const REFUSAL_TEXT: Record<string, string> = {
  unauthorized: "You are signed out. Sign in again.",
  "unknown folder":
    "The Mac does not know that folder any more. Pick another folder.",
  "invalid request": "Pick a Mac and a folder, and write a first message.",
  "message too long": `The first message is too long. It may be at most ${MAX_FIRST_MESSAGE_CHARS.toLocaleString("en-US")} characters.`,
};

/** What the hire request came to: the order to follow, or why it was refused. */
export type HireResult =
  | { ok: true; order: HireResponse }
  | { ok: false; error: string };

/**
 * Sends one hire to the server.
 * @param request - The Mac, the folder and the first message.
 * @returns The order, or the refusal's text.
 */
export async function postHire(request: HireRequest): Promise<HireResult> {
  try {
    const response = await fetch("/api/office/hire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) {
      return {
        ok: true,
        order: hireResponseSchema.parse(await response.json()),
      };
    }
    const body: { error?: string } = await response.json().catch(() => ({}));
    const text = body.error ? (REFUSAL_TEXT[body.error] ?? body.error) : "";
    return { ok: false, error: text || "Could not hire." };
  } catch {
    return { ok: false, error: "Could not reach the office." };
  }
}
