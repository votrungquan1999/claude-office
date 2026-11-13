import { sortByListOrder } from "@/shared/list-order";
import type { SessionDto } from "@/shared/session";
import {
  type OfficeData,
  overviewOf,
  shownSessions,
  type TagPick,
  tagFilterOf,
} from "../officeData";

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

/**
 * The viewed company's live rows in list order as the owner's pending moves lay them, and which of them the tag filter shows.
 * @param data - What the browser knows.
 * @param companyKey - The company being viewed.
 * @param tagPick - The owner's last tag pick.
 * @returns The rows, also those the filter hides, and the filter's test.
 */
export function companyRowsOf(
  data: OfficeData,
  companyKey: string | null,
  tagPick: TagPick,
) {
  const shown = shownSessions(data);
  const { tree } = overviewOf(data, new Date());
  const { matches } = tagFilterOf(shown, tree.companyOf, companyKey, tagPick);
  return {
    rows: companyRows(
      shown.values(),
      (session) => tree.companyOf(session)?.companyKey,
      companyKey,
    ),
    matches,
  };
}
