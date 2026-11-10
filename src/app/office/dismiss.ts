import {
  type DismissRequest,
  type OrderResponse,
  orderResponseSchema,
} from "@/shared/commands";
import { type OrderResult, postOrder } from "./post-order";

/** Server refusals that are not already plain sentences. */
const REFUSAL_TEXT: Record<string, string> = {
  unauthorized: "You are signed out. Sign in again.",
  "invalid request": "That employee cannot be dismissed.",
  "that employee cannot be dismissed":
    "That employee is not held at its desk any more.",
};

/** What the dismiss request came to: the order to follow, or why it was refused. */
export type DismissResult = OrderResult<OrderResponse>;

/**
 * Sends one dismiss to the server.
 * @param request - The Mac and the session to dismiss.
 * @returns The order, or the refusal's text.
 */
export async function postDismiss(
  request: DismissRequest,
): Promise<DismissResult> {
  return postOrder(
    "/api/office/dismiss",
    request,
    orderResponseSchema,
    REFUSAL_TEXT,
    "Could not dismiss.",
  );
}
