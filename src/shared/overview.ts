import { buildCompanyTree, type Company, type CompanyTree } from "./companies";
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
    }))
    .sort(
      (a, b) =>
        a.machineName.localeCompare(b.machineName) ||
        a.machineId.localeCompare(b.machineId),
    );
  return { macs, tree };
}
