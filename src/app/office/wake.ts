import {
  type OrderResponse,
  orderResponseSchema,
  type WakeRequest,
} from "@/shared/commands";
import { type OrderResult, postOrder } from "./post-order";

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
export type WakeResult = OrderResult<OrderResponse>;

/**
 * Sends one wake to the server.
 * @param request - The Mac and the session to wake.
 * @returns The order, or the refusal's text.
 */
export async function postWake(request: WakeRequest): Promise<WakeResult> {
  return postOrder(
    "/api/office/wake",
    request,
    orderResponseSchema,
    REFUSAL_TEXT,
    "Could not wake.",
  );
}
