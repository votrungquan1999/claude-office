import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const registryEntrySchema = z.object({
  sessionId: z.string(),
  kind: z.string().optional(),
  name: z.string().optional(),
  startedAt: z.number().optional(),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

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
