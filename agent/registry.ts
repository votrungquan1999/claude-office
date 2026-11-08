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

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

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
    if (entry.success && entry.data.sessionId === sessionId) return entry.data;
  }
  return undefined;
}

/**
 * Every session in Claude Code's registry.
 * @param home - The user's home folder.
 * @returns The readable entries; unreadable or half-written files are skipped.
 */
export function listRegistry(home: string): RegistryEntry[] {
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
    const entry = registryEntrySchema.safeParse(raw);
    if (entry.success) entries.push(entry.data);
  }
  return entries;
}
