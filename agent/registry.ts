import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** A field of an unexpected type or value is read as absent, so a format change never drops the whole entry. */
const lenient = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);

// Only the fields the agent uses; Claude Code writes many more and adds some over time.
const registryEntrySchema = z.object({
  sessionId: z.string(),
  pid: lenient(z.number()),
  kind: lenient(z.string()),
  /** How the session was started: `cli`, `claude-vscode`, `sdk-cli` (`claude -p`), `sdk-ts`, `sdk-py`. */
  entrypoint: lenient(z.string()),
  name: lenient(z.string()),
  cwd: lenient(z.string()),
  status: lenient(z.enum(["idle", "busy", "waiting"])),
  /** Epoch ms. */
  startedAt: lenient(z.number()),
  /** Epoch ms of the last status change. */
  statusUpdatedAt: lenient(z.number()),
  /** `ps -o lstart` text of the session's process; tells a reused pid from the original. */
  procStart: lenient(z.string()),
  /** Id of the Remote Control session; absent while Remote Control is off. */
  bridgeSessionId: lenient(z.string()),
});

export interface RegistryEntry extends z.infer<typeof registryEntrySchema> {
  /** The command line of the entry's process, read from `ps`; absent when the process cannot be found. */
  args?: string;
}

/** Command lines by `pid:procStart`; a process never changes its arguments. */
const argsCache = new Map<string, string>();
/** When `ps` last found no process for a `pid:procStart`; a dead process is not asked about again for a while. */
const missCache = new Map<string, number>();
const ARGS_CACHE_LIMIT = 1000;
const MISS_TTL_MS = 10_000;

/** The cache key of one registered process. */
function argsKey(pid: number, procStart?: string): string {
  return `${pid}:${procStart ?? ""}`;
}

/**
 * Remembers a command line read from the process table, so hook-time lookups need no `ps` of their own.
 * @param pid - The process's pid.
 * @param procStart - The recorded start time of the registry entry.
 * @param args - The process's command line.
 */
export function rememberProcessArgs(
  pid: number,
  procStart: string | undefined,
  args: string,
): void {
  if (argsCache.size >= ARGS_CACHE_LIMIT) argsCache.clear();
  argsCache.set(argsKey(pid, procStart), args);
}

/**
 * Reads the command line of a registered process, from the cache or one `ps` call.
 * @param pid - The entry's pid.
 * @param procStart - The entry's recorded start time, which tells a reused pid from the original.
 * @returns The command line, or undefined when `ps` cannot find the process.
 */
function readProcessArgs(pid: number, procStart?: string): string | undefined {
  const key = argsKey(pid, procStart);
  const cached = argsCache.get(key);
  if (cached !== undefined) return cached;
  const missedAt = missCache.get(key);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) {
    return undefined;
  }
  let args: string;
  try {
    args = execFileSync("ps", ["-ww", "-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // `ps` exits non-zero for a pid that is gone; an unreadable command line leaves the session shown.
    args = "";
  }
  if (!args) {
    if (missCache.size >= ARGS_CACHE_LIMIT) missCache.clear();
    missCache.set(key, Date.now());
    return undefined;
  }
  missCache.delete(key);
  rememberProcessArgs(pid, procStart, args);
  return args;
}

/** Whether an entry would show but for its command line, so only such an entry's command line is worth reading. */
function needsArgs(entry: RegistryEntry): boolean {
  return (
    entry.pid !== undefined &&
    entry.kind === "interactive" &&
    !entry.entrypoint?.startsWith("sdk-")
  );
}

/**
 * Whether a command line is a one-off `claude -p` run: `-p` or `--print` as an option, before any `--`.
 * @param args - The process's command line.
 * @returns True for a print run; a message after `--` never counts.
 */
export function isPrintRunArgs(args: string | undefined): boolean {
  if (!args) return false;
  for (const token of args.split(/\s+/)) {
    if (token === "--") return false;
    if (token === "-p" || token === "--print") return true;
  }
  return false;
}

/**
 * Whether the office shows a session: a chat session, not a `claude -p` run or an Agent SDK program.
 * @param entry - The session's registry entry.
 * @returns True when the session gets a desk.
 */
export function isShownEntry(entry: RegistryEntry): boolean {
  return (
    entry.kind === "interactive" &&
    !entry.entrypoint?.startsWith("sdk-") &&
    // The CLI inherits its parent's entrypoint, so a print run can register as `claude-vscode`.
    !isPrintRunArgs(entry.args)
  );
}

/**
 * Whether the registry folder can be listed at all. When it cannot, "no entry" says nothing about a session.
 * @param home - The user's home folder.
 * @returns True when `~/.claude/sessions` is readable.
 */
export function isRegistryReadable(home: string): boolean {
  try {
    readdirSync(join(home, ".claude", "sessions"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a running session in Claude Code's own registry (`~/.claude/sessions/<pid>.json`).
 * @param home - The user's home folder.
 * @param sessionId - The session to look for.
 * @returns The entry, or undefined when the registry does not list it (yet).
 */
export function findRegistryEntry(
  home: string,
  sessionId: string,
): RegistryEntry | undefined {
  const dir = join(home, ".claude", "sessions");
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return undefined;
  }
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      // A file mid-write or removed since the listing: skip it.
      continue;
    }
    const entry = registryEntrySchema.safeParse(raw);
    if (entry.success && entry.data.sessionId === sessionId) {
      // Hook time has no process table at hand: the cache, then one lookup for this entry.
      const args = needsArgs(entry.data)
        ? readProcessArgs(entry.data.pid as number, entry.data.procStart)
        : undefined;
      return args === undefined ? entry.data : { ...entry.data, args };
    }
  }
  return undefined;
}

/**
 * Every session in Claude Code's registry.
 * @param home - The user's home folder.
 * @param argsOf - Gives an entry's command line, usually from the process table the caller already read; no `ps` runs here.
 * @returns The readable entries; unreadable or half-written files are skipped.
 */
export function listRegistry(
  home: string,
  argsOf?: (entry: RegistryEntry) => string | undefined,
): RegistryEntry[] {
  const dir = join(home, ".claude", "sessions");
  let files: string[];
  try {
    // `*.json` only: the `<pid>.<hash>.key` files next to them are secrets.
    files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  const entries: RegistryEntry[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      // A file mid-write or removed since the listing: skip it.
      continue;
    }
    const parsed = registryEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const args = needsArgs(parsed.data) ? argsOf?.(parsed.data) : undefined;
    if (args === undefined) {
      entries.push(parsed.data);
      continue;
    }
    if (parsed.data.pid !== undefined) {
      rememberProcessArgs(parsed.data.pid, parsed.data.procStart, args);
    }
    entries.push({ ...parsed.data, args });
  }
  return entries;
}
