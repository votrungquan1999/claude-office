import { sortByListOrder } from "@/shared/list-order";
import type { SessionDto } from "@/shared/session";

/**
 * The company's live employees in the owner's order, also those a tag filter hides.
 * @param sessions - Every session this device knows, with the owner's pending moves laid over.
 * @param companyKeyOf - The company a session belongs to.
 * @param companyKey - The company being viewed.
 * @returns Its rows that have not gone home, in list order.
 */
export function companyRows(
  sessions: Iterable<SessionDto>,
  companyKeyOf: (session: SessionDto) => string | undefined,
  companyKey: string | null,
): SessionDto[] {
  return sortByListOrder(
    [...sessions].filter(
      (session) =>
        session.state !== "wentHome" && companyKeyOf(session) === companyKey,
    ),
  );
}
