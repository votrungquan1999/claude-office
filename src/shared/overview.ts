import {
  buildCompanyTree,
  type Company,
  type CompanyTree,
  type SwitchedOffFolder,
} from "./companies";
import type { FolderDto } from "./folders";
import type { MachineDto, SessionDto } from "./session";

/** Sessions in a company by room; Thinking counts as Working. */
export interface CompanyCounts {
  working: number;
  needsPermission: number;
  waitingForYou: number;
  idle: number;
}

export interface CompanyOverview {
  company: Company;
  counts: CompanyCounts;
  /** Sessions here need the owner: Needs permission or Waiting for you, on an online Mac. */
  needsYou: boolean;
  /** A live session lives here, or one went home today; only these show in the strip. */
  active: boolean;
}

export interface MacOverview {
  machineId: string;
  machineName: string;
  online: boolean;
  companies: CompanyOverview[];
  switchedOff: SwitchedOffFolder[];
}

export interface Overview {
  macs: MacOverview[];
  tree: CompanyTree;
}

export interface OverviewInput {
  folders: FolderDto[];
  sessions: SessionDto[];
  machines: MachineDto[];
  offlineMachineIds: ReadonlySet<string>;
  /** Sessions that went home today, as `todaysDepartures` lists them. */
  departures: SessionDto[];
}

/**
 * Counts the sessions of every Mac's every company once, so the strip and the drawer cannot disagree.
 * @param input - Everything the browser knows.
 * @returns Per Mac, its companies with four counts each.
 */
export function buildOverview(input: OverviewInput): Overview {
  const names = new Map<string, string>();
  for (const session of input.sessions) {
    names.set(session.machineId, session.machineName);
  }
  // A record's name wins; a Mac with sessions but no record still shows.
  for (const machine of input.machines) {
    names.set(machine.machineId, machine.machineName);
  }
  const tree = buildCompanyTree({
    folders: input.folders,
    sessions: input.sessions,
    machineIds: new Set(names.keys()),
  });
  const overviews = new Map<string, CompanyOverview>(
    tree.companies.map((company) => [
      company.key,
      {
        company,
        counts: { working: 0, needsPermission: 0, waitingForYou: 0, idle: 0 },
        needsYou: false,
        active: false,
      },
    ]),
  );
  for (const session of input.sessions) {
    const home = tree.companyOf(session);
    const entry = home && overviews.get(home.companyKey);
    if (!entry || session.state === "wentHome") continue;
    entry.active = true;
    const room = session.state === "thinking" ? "working" : session.state;
    entry.counts[room] += 1;
  }
  for (const session of input.departures) {
    const home = tree.companyOf(session);
    const entry = home && overviews.get(home.companyKey);
    if (entry) entry.active = true;
  }
  for (const entry of overviews.values()) {
    entry.needsYou =
      !input.offlineMachineIds.has(entry.company.machineId) &&
      entry.counts.needsPermission + entry.counts.waitingForYou > 0;
  }
  const macs = [...names]
    .map(([machineId, machineName]) => ({
      machineId,
      machineName,
      online: !input.offlineMachineIds.has(machineId),
      companies: tree.companies
        .filter((company) => company.machineId === machineId)
        .map((company) => overviews.get(company.key))
        .filter((entry): entry is CompanyOverview => entry !== undefined),
      switchedOff: tree.switchedOff.filter(
        (folder) => folder.machineId === machineId,
      ),
    }))
    .sort(
      (a, b) =>
        a.machineName.localeCompare(b.machineName) ||
        a.machineId.localeCompare(b.machineId),
    );
  return { macs, tree };
}

/**
 * Picks the company the office shows: the pick while it still exists, else the first non-Other company with a live session (scanning online Macs in name order), else a live Other, else the first non-Other company, "Other" only when nothing else exists.
 * @param overview - The current overview.
 * @param stored - The last pick, if any.
 * @param options - `restored` marks a pick read back from browser storage rather than made in this page; it holds only while its company is active, so a company that rolled off the strip days ago is not reopened empty.
 * @returns The company key, or null when there are no companies.
 */
export function resolveSelection(
  overview: Overview,
  stored: string | null,
  { restored = false }: { restored?: boolean } = {},
): string | null {
  const all = overview.macs.flatMap((mac) => mac.companies);
  if (
    stored &&
    all.some(
      (entry) => entry.company.key === stored && (!restored || entry.active),
    )
  )
    return stored;
  const isLive = (entry: CompanyOverview) =>
    Object.values(entry.counts).reduce((sum, n) => sum + n, 0) > 0;
  const online = overview.macs.filter((mac) => mac.online);
  // Online Macs are already in name order, so the first live company wins across Macs.
  const live = online
    .flatMap((mac) => mac.companies)
    .find((entry) => !entry.company.other && isLive(entry));
  // Work in Other still counts, so the office never opens empty while a live session exists.
  const liveOther = online
    .flatMap((mac) => mac.companies)
    .find((entry) => entry.company.other && isLive(entry));
  // Offline Macs only supply the default when no online Mac has a company.
  const firstOf = (macs: MacOverview[]) =>
    macs.flatMap((mac) => mac.companies).find((entry) => !entry.company.other)
      ?.company.key;
  return (
    live?.company.key ??
    liveOther?.company.key ??
    firstOf(online) ??
    firstOf(overview.macs) ??
    all[0]?.company.key ??
    null
  );
}
