import type { ZodType } from "zod";

/** What an order request came to: the order to follow, or why it was refused. */
export type OrderResult<Order> =
  | { ok: true; order: Order }
  | { ok: false; error: string };

/**
 * Sends one order request to the server.
 * @param url - The order's route.
 * @param request - The JSON body.
 * @param schema - Parses the accepted answer.
 * @param refusals - Server refusals that are not already plain sentences, by the server's error text.
 * @param fallbackText - What to say when the refusal carries no text.
 * @returns The order, or the refusal's text.
 */
export async function postOrder<Order>(
  url: string,
  request: unknown,
  schema: ZodType<Order>,
  refusals: Record<string, string>,
  fallbackText: string,
): Promise<OrderResult<Order>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.ok) {
      return { ok: true, order: schema.parse(await response.json()) };
    }
    const body: { error?: string } = await response.json().catch(() => ({}));
    const text = body.error ? (refusals[body.error] ?? body.error) : "";
    return { ok: false, error: text || fallbackText };
  } catch {
    return { ok: false, error: "Could not reach the office." };
  }
}
