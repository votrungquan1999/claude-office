import { todaysDepartures } from "@/office/wentHome";
import type { FolderDto } from "@/shared/folders";
import { buildOverview } from "@/shared/overview";
import type { MachineDto, SessionDto } from "@/shared/session";
import {
  buildTagFilter,
  SHOW_ALL,
  type TagFilterSelection,
} from "@/shared/tag-filter";
import { applyEmployeeNames, type PendingEmployeeNames } from "./employeeName";
import { applyRanks, type PendingRanks } from "./list/pendingRanks";
import {
  applyNames,
  applyOverrides,
  type ModeOverrides,
  type NameOverrides,
  type SessionMap,
} from "./officeStore";
import { applyReviewMoves, type ReviewMoves } from "./reviewSeen";

/** What the last answer left in the browser. */
export interface OfficeData {
  sessions: SessionMap;
  machines: MachineDto[];
  folders: FolderDto[];
  /** Switches the owner pressed that no answer has confirmed yet. */
  overrides: ModeOverrides;
  /** Company names the owner pressed that no answer has confirmed yet. */
  names: NameOverrides;
  /** Reviews the owner moved to Idle on this device that no answer has confirmed yet. */
  reviewMoves: ReviewMoves;
  /** Employee names the owner gave on this device that no answer has confirmed yet. */
  employeeNames: PendingEmployeeNames;
  /** List places the owner gave on this device that no answer has confirmed yet. */
  ranks: PendingRanks;
  offline: ReadonlySet<string>;
}

/**
 * The sessions as this device shows them: the answers' sessions with the owner's pending moves laid over.
 * @param data - What the browser knows.
 * @returns The sessions to show.
 */
export function shownSessions(data: OfficeData): SessionMap {
  return applyRanks(
    applyEmployeeNames(
      applyReviewMoves(data.sessions, data.reviewMoves),
      data.employeeNames,
    ),
    data.ranks,
  );
}

/**
 * The overview of everything the browser knows, with today's departures.
 * @param data - Sessions, Macs and folders.
 * @param now - The current time.
 * @returns The per-Mac overview.
 */
export function overviewOf(data: OfficeData, now: Date) {
  const sessions = [...shownSessions(data).values()];
  return buildOverview({
    folders: applyNames(
      applyOverrides(data.folders, data.overrides),
      data.names,
    ),
    sessions,
    machines: data.machines,
    offlineMachineIds: data.offline,
    departures: todaysDepartures(sessions, now),
  });
}

/** The tag the owner picked, and the company it was picked in; in any other company it means All. */
export interface TagPick {
  companyKey: string | null;
  selection: TagFilterSelection;
}

/**
 * The tag filter of one company, from what the browser knows.
 * @param sessions - Every session the browser knows.
 * @param companyOf - Places a session in its company.
 * @param companyKey - The viewed company.
 * @param pick - The owner's last pick.
 * @returns The filter's chips and who it shows.
 */
export function tagFilterOf(
  sessions: SessionMap,
  companyOf: (session: SessionDto) => { companyKey: string } | null,
  companyKey: string | null,
  pick: TagPick,
) {
  return buildTagFilter(
    [...sessions.values()].filter(
      (session) => companyOf(session)?.companyKey === companyKey,
    ),
    pick.companyKey === companyKey ? pick.selection : SHOW_ALL,
  );
}
