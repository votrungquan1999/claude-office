import {
  type WakeRequest,
  type WakeResponse,
  wakeResponseSchema,
} from "@/shared/commands";

/** Server refusals that are not already plain sentences. */
const REFUSAL_TEXT: Record<string, string> = {
  unauthorized: "You are signed out. Sign in again.",
  "invalid request": "That employee cannot be woken.",
  "that employee cannot be woken":
    "That employee is running or already waking; it cannot be woken now.",
  "a wake for this employee is already on its way":
    "That employee is already being woken.",
};

/** What the wake request came to: the order to follow, or why it was refused. */
export type WakeResult =
  | { ok: true; order: WakeResponse }
  | { ok: false; error: string };

/**
 * Sends one wake to the server.
 * @param request - The Mac and the session to wake.
 * @returns The order, or the refusal's text.
 */
export async function postWake(request: WakeRequest): Promise<WakeResult> {
  try {
    const response = await fetch("/api/office/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) {
      return {
        ok: true,
        order: wakeResponseSchema.parse(await response.json()),
      };
    }
    const body: { error?: string } = await response.json().catch(() => ({}));
    const text = body.error ? (REFUSAL_TEXT[body.error] ?? body.error) : "";
    return { ok: false, error: text || "Could not wake." };
  } catch {
    return { ok: false, error: "Could not reach the office." };
  }
}
