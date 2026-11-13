import { searchableSessions } from "@/office/wentHome";
import { placeOf } from "@/shared/list-order";
import { selectNeedsYou } from "@/shared/needs-you";
import { type SessionDto, sessionKey } from "@/shared/session";
import type { overviewOf } from "../officeData";
import type { SessionMap } from "../officeStore";
import { useDeviceSettings } from "../settings/deviceSettings";
import { useTabTitle } from "../useTabTitle";
import { companyRows } from "./companyRows";
import { useListFolds } from "./useListFolds";

interface ListModelInput {
  /** Every session this device knows, with the owner's pending moves laid over. */
  sessions: SessionMap;
  overview: ReturnType<typeof overviewOf>;
  /** The company being viewed. */
  companyKey: string | null;
  /** Whether the tag filter shows a session. */
  matches: (session: SessionDto) => boolean;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  offlineIds: ReadonlySet<string>;
  /** The current time, which decides what went home today. */
  now: Date;
  /** Whether the first answer is in. */
  loaded: boolean;
}

/**
 * What the list shows: the viewed company's rows, the open card's place, the Needs you copies and the folds. It also sets the browser tab's title from the Needs you count.
 * @param input - The sessions, the view and the selection.
 * @returns The rows the filter shows, the selected row's place, Needs you, and the fold state.
 */
export function useListModel({
  sessions,
  overview,
  companyKey,
  matches,
  selectedKey,
  offlineIds,
  now,
  loaded,
}: ListModelInput) {
  const { needsYouOtherCompanies, tabCount } = useDeviceSettings();
  const rows = companyRows(
    sessions.values(),
    (session) => overview.tree.companyOf(session)?.companyKey,
    companyKey,
  );
  const companyOrder = overview.macs.flatMap((mac) =>
    mac.companies.map((entry) => entry.company.key),
  );
  const needsYouOf = (includeOtherCompanies: boolean) =>
    selectNeedsYou({
      sessions: sessions.values(),
      companyOf: (session) => overview.tree.companyOf(session),
      viewedCompany: companyKey,
      companyOrder,
      offlineMachineIds: offlineIds,
      includeOtherCompanies,
    });
  // The tab counts every company whatever Needs you lists
  const everywhere = needsYouOf(true);
  useTabTitle(everywhere.total, tabCount);
  const needsYou = needsYouOtherCompanies ? everywhere : needsYouOf(false);
  const listFold = useListFolds(
    new Set(
      [...needsYou.own, ...needsYou.others.flatMap((g) => g.rows)].map(
        sessionKey,
      ),
    ),
    new Set(
      [...everywhere.own, ...everywhere.others.flatMap((g) => g.rows)].map(
        sessionKey,
      ),
    ),
    loaded,
  );
  return {
    // The tag filter narrows the list like the office
    everyone: rows.filter(matches),
    // The card's place counts the whole company, so a repo filter never changes it
    selectedPlace: selectedKey ? placeOf(rows, selectedKey) : null,
    needsYou,
    listFold,
    // Everything a phone search reads; the repo filter does not narrow it
    searchPool: {
      viewedCompanyKey: companyKey,
      own: rows,
      sessions: searchableSessions([...sessions.values()], now),
      companyOf: overview.tree.companyOf,
      companyOrder,
    },
  };
}
