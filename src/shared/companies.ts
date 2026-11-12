import type { FolderDto } from "./folders";
import type { SessionDto } from "./session";

/** The session fields the company rule reads. */
export type CompanySessionInput = Pick<
  SessionDto,
  "machineId" | "sessionId" | "cwd" | "startCwd"
>;

export interface CompanyTreeInput {
  /** Folder records of every Mac. */
  folders: FolderDto[];
  /** Sessions whose start folders count as known folders even without a record. */
  sessions: CompanySessionInput[];
  /** Macs that exist; folders of any other Mac are ignored. */
  machineIds: ReadonlySet<string>;
}

/** One company of one Mac. */
export interface Company {
  /** Unique across Macs: the Mac plus the company folder, or the Mac's "Other" sentinel. */
  key: string;
  machineId: string;
  /** What the company is called: the owner's name when set, else the folder name. */
  name: string;
  /** The name derived from the folder, kept even when the owner renamed the company. */
  folderName: string;
  /** The company folder; null for the Mac's "Other" company. */
  path: string | null;
  other: boolean;
}

/** Where one session sits. */
export interface SessionCompany {
  companyKey: string;
  companyName: string;
  /** The start folder below the company folder; absent when the session started at the company folder. */
  project?: string;
}

/** A folder whose company mode is off: its sessions sit in Other and its children are companies. */
export interface SwitchedOffFolder {
  machineId: string;
  path: string;
  name: string;
  /** The folder's own name, which differs from `name` once the owner names it. */
  folderName: string;
}

export interface CompanyTree {
  /** Per Mac in the order the Macs were first seen; by name within a Mac, "Other" last. */
  companies: Company[];
  /** Per Mac, the folders switched off while they would be companies: their children became companies and their own sessions sit in Other. */
  switchedOff: SwitchedOffFolder[];
  /**
   * Places a session in its company.
   * @param session - The session to place.
   * @returns Its company and project, or null when its Mac is unknown.
   */
  companyOf(session: CompanySessionInput): SessionCompany | null;
}

/**
 * Strips trailing slashes so "/a/b/" and "/a/b" are one folder.
 * @param path - A folder path.
 * @returns The path without trailing slashes; the root stays "/".
 */
function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/**
 * Whether a folder is the other one or lies below it, compared by whole segments.
 * @param ancestor - The outer folder.
 * @param path - The folder to test.
 * @returns True for the same folder or a descendant.
 */
function isWithin(ancestor: string, path: string): boolean {
  if (ancestor === "/") return path.startsWith("/");
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/**
 * The last segment of a folder.
 * @param path - A normalised folder path.
 * @returns Its name; the root is "/".
 */
function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * The parent folder's name, used to tell two same-named companies apart.
 * @param path - A normalised folder path.
 * @returns "parent/name", or just the name at the root.
 */
function nameWithParent(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

/**
 * The company folders of one Mac: the outermost known folders whose company mode is on; an off folder hands its job to the child folders that hold known folders, at any depth.
 * @param known - Every known folder of the Mac.
 * @param off - The known folders whose company mode is off.
 * @param switchedOff - Collects the off folders whose switch took effect.
 * @returns The company folders.
 */
function companyPaths(
  known: Set<string>,
  off: Set<string>,
  switchedOff: string[],
): string[] {
  const resolve = (path: string): string[] => {
    // A flag only matters on a folder that is a candidate; the virtual ones in between count as on.
    if (!known.has(path) || !off.has(path)) return [path];
    switchedOff.push(path);
    const prefix = path === "/" ? "" : path;
    const children = new Set<string>();
    for (const other of known) {
      if (other !== path && isWithin(path, other)) {
        const segment = other.slice(prefix.length + 1).split("/")[0];
        children.add(`${prefix}/${segment}`);
      }
    }
    return [...children].flatMap(resolve);
  };
  const tops = [...known].filter(
    (path) =>
      ![...known].some((other) => other !== path && isWithin(other, path)),
  );
  return tops.flatMap(resolve);
}

/**
 * Builds the company tree from folder records and the start folders sessions report.
 * @param input - Folder records, sessions and the Macs that exist.
 * @returns Every company and a way to place sessions in them.
 */
export function buildCompanyTree(input: CompanyTreeInput): CompanyTree {
  const knownByMac = new Map<string, Set<string>>();
  const offByMac = new Map<string, Set<string>>();
  // The owner's names, by Mac and normalised folder.
  const namesByMac = new Map<string, Map<string, string>>();
  const startOf = (session: CompanySessionInput) =>
    normalize(session.startCwd ?? session.cwd);
  for (const { machineId, path, companyMode, displayName } of input.folders) {
    // A Mac with no record is hidden until it reports, and keeps its switches meanwhile.
    if (!input.machineIds.has(machineId)) continue;
    const normalized = normalize(path);
    knownByMac.set(
      machineId,
      (knownByMac.get(machineId) ?? new Set()).add(normalized),
    );
    if (displayName) {
      namesByMac.set(
        machineId,
        (namesByMac.get(machineId) ?? new Map()).set(normalized, displayName),
      );
    }
    if (!companyMode) {
      offByMac.set(
        machineId,
        (offByMac.get(machineId) ?? new Set()).add(normalized),
      );
    }
  }
  for (const session of input.sessions) {
    knownByMac.set(
      session.machineId,
      (knownByMac.get(session.machineId) ?? new Set()).add(startOf(session)),
    );
  }
  const companies: Company[] = [];
  const switchedOff: CompanyTree["switchedOff"] = [];
  const pathsByMac = new Map<string, string[]>();
  for (const [machineId, known] of knownByMac) {
    const offPaths: string[] = [];
    const paths = [
      ...new Set(
        companyPaths(known, offByMac.get(machineId) ?? new Set(), offPaths),
      ),
    ];
    const offUnique = [...new Set(offPaths)];
    pathsByMac.set(machineId, paths);
    // A name repeated among this Mac's companies and switched-off folders gets its parent folder.
    const taken = new Map<string, number>();
    for (const path of [...paths, ...offUnique]) {
      taken.set(lastSegment(path), (taken.get(lastSegment(path)) ?? 0) + 1);
    }
    const folderNameOf = (path: string) =>
      (taken.get(lastSegment(path)) ?? 0) > 1
        ? nameWithParent(path)
        : lastSegment(path);
    const nameOf = (path: string) =>
      namesByMac.get(machineId)?.get(path) ?? folderNameOf(path);
    for (const path of offUnique) {
      switchedOff.push({
        machineId,
        path,
        name: nameOf(path),
        folderName: folderNameOf(path),
      });
    }
    const named = paths.map((path) => ({
      key: `${machineId}\0${path}`,
      machineId,
      name: nameOf(path),
      folderName: folderNameOf(path),
      path,
      other: false,
    }));
    companies.push(...named.sort((a, b) => a.name.localeCompare(b.name)));
  }
  const others = new Map<string, Company>();
  /**
   * The Other company of a Mac, made on first use.
   * @param machineId - The Mac.
   * @returns Its Other company.
   */
  const otherOf = (machineId: string): Company => {
    const other = others.get(machineId) ?? {
      key: `${machineId}\0\0other`,
      machineId,
      name: "Other",
      folderName: "Other",
      path: null,
      other: true,
    };
    others.set(machineId, other);
    return other;
  };
  // A Mac with a switched-off folder always lists Other, so the drawer has a row for sessions that land there later.
  for (const { machineId } of switchedOff) otherOf(machineId);
  /**
   * Places one session.
   * @param session - The session to place.
   * @returns Its company and project, or null for an unknown Mac.
   */
  const place = (session: CompanySessionInput): SessionCompany | null => {
    if (!knownByMac.has(session.machineId)) return null;
    const start = startOf(session);
    const company = companies.find(
      (candidate) =>
        candidate.machineId === session.machineId &&
        candidate.path !== null &&
        isWithin(candidate.path, start),
    );
    if (company?.path) {
      const project = start.slice(company.path.length).replace(/^\//, "");
      return {
        companyKey: company.key,
        companyName: company.name,
        ...(project ? { project } : {}),
      };
    }
    // The session's own folder is switched off, so no company holds it.
    const other = otherOf(session.machineId);
    return {
      companyKey: other.key,
      companyName: other.name,
      project: lastSegment(start),
    };
  };
  for (const session of input.sessions) place(session);
  // Other sorts last within its Mac.
  for (const other of others.values()) {
    const last = companies.findLastIndex(
      (c) => c.machineId === other.machineId,
    );
    companies.splice(last + 1, 0, other);
  }
  return { companies, switchedOff, companyOf: place };
}
