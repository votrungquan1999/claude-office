import {
  type HireRequest,
  MAX_FIRST_MESSAGE_CHARS,
  type OrderResponse,
  orderResponseSchema,
} from "@/shared/commands";
import { type OrderResult, postOrder } from "./post-order";

/** Server refusals that are not already plain sentences. */
const REFUSAL_TEXT: Record<string, string> = {
  unauthorized: "You are signed out. Sign in again.",
  "unknown folder":
    "The Mac does not know that folder any more. Pick another folder.",
  "invalid request": "Pick a Mac and a folder, and write a first message.",
  "message too long": `The first message is too long. It may be at most ${MAX_FIRST_MESSAGE_CHARS.toLocaleString("en-US")} characters.`,
};

/** What the hire request came to: the order to follow, or why it was refused. */
export type HireResult = OrderResult<OrderResponse>;

/**
 * Sends one hire to the server.
 * @param request - The Mac, the folder and the first message.
 * @returns The order, or the refusal's text.
 */
export async function postHire(request: HireRequest): Promise<HireResult> {
  return postOrder(
    "/api/office/hire",
    request,
    orderResponseSchema,
    REFUSAL_TEXT,
    "Could not hire.",
  );
}
