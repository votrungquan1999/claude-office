import { useEffect, useRef, useState } from "react";
import {
  CommandFailReason,
  CommandStatus,
  NOT_SENT_AFTER_MS,
  orderStatusSchema,
} from "@/shared/commands";

/** How an order the owner gave is doing, as the screen shows it. */
export type OrderPhase =
  | { phase: "none" }
  | { phase: "pending" }
  | { phase: "done" }
  | { phase: "failed"; reason: CommandFailReason }
  | { phase: "notSent" }
  | { phase: "lostContact" }
  | { phase: "checkMac" };

const POLL_MS = 2000;
/** Without a good answer from the office for this long the owner is told contact was lost. */
const LOST_CONTACT_AFTER_MS = 35_000;
/** An order still claimed this long after it was given is far past a normal window launch. */
const CHECK_MAC_AFTER_MS = 120_000;

/**
 * Follows one order until it is done, failed or clearly never picked up.
 * @param orderId - The order to follow; null follows nothing.
 * @param onDone - Called once when the order is done.
 * @returns The order's phase.
 */
export function useOrderStatus(
  orderId: string | null,
  onDone?: () => void,
): OrderPhase {
  // Read at call time so a new callback never restarts the polling.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [seen, setSeen] = useState<{ id: string; phase: OrderPhase } | null>(
    null,
  );
  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastAnswerAt = Date.now();
    const show = (phase: OrderPhase) => {
      if (!stopped) setSeen({ id: orderId, phase });
    };
    const check = async () => {
      let next: OrderPhase | undefined;
      try {
        const response = await fetch(`/api/office/commands/${orderId}`);
        if (response.status === 404) {
          next = { phase: "notSent" };
        } else if (response.ok) {
          const order = orderStatusSchema.parse(await response.json());
          lastAnswerAt = Date.now();
          if (order.status === CommandStatus.Done) next = { phase: "done" };
          else if (order.status === CommandStatus.Failed) {
            next = {
              phase: "failed",
              reason: order.reason ?? CommandFailReason.LaunchFailed,
            };
          } else if (
            order.status === CommandStatus.Pending &&
            order.ageMs > NOT_SENT_AFTER_MS
          ) {
            // Judged by the database clock, never the browser's.
            next = { phase: "notSent" };
          } else if (
            order.status === CommandStatus.Claimed &&
            order.ageMs > CHECK_MAC_AFTER_MS
          ) {
            next = { phase: "checkMac" };
          }
        }
      } catch {
        // A lost answer is retried; only the silence time ends the wait.
      }
      if (!next && Date.now() - lastAnswerAt > LOST_CONTACT_AFTER_MS) {
        next = { phase: "lostContact" };
      }
      if (next) {
        show(next);
        if (next.phase === "done" && !stopped) onDoneRef.current?.();
        return;
      }
      show({ phase: "pending" });
      if (!stopped) timer = setTimeout(check, POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId]);
  if (!orderId) return { phase: "none" };
  // An answer for an older order never shows under a newer one.
  return seen?.id === orderId ? seen.phase : { phase: "pending" };
}
