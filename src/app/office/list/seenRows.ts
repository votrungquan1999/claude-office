import { z } from "zod";

/** How the seen set reaches the browser's storage; a getter, because even reaching `localStorage` can throw. */
export type SeenStorage = () => Pick<Storage, "getItem" | "setItem">;

const SEEN_ROWS_STORAGE_KEY = "claude-office.seen-rows";

/** How many opened conversations a device remembers; the oldest go first. */
export const SEEN_ROWS_LIMIT = 1000;

const seenRowsSchema = z.array(z.string());

/**
 * Reads the stored keys.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The keys; null when nothing readable is stored.
 */
function parseSeenRows(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  // Storage text can be anything the browser kept
  try {
    const parsed = seenRowsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? new Set(parsed.data) : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the seen keys on this device.
 * @param storage - The browser's storage.
 * @param keys - The keys to remember.
 */
function storeSeenRows(storage: SeenStorage, keys: ReadonlySet<string>): void {
  try {
    storage().setItem(SEEN_ROWS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // The dots still work for this visit.
  }
}

/**
 * The conversations this device has already shown or opened, and their remembered set.
 * @param storage - The browser's storage.
 * @param currentKeys - The session keys the first answer holds.
 * @returns The keys that count as seen; null when storage is unavailable, so no row gets a dot.
 */
export function loadSeenRows(
  storage: SeenStorage,
  currentKeys: readonly string[],
): ReadonlySet<string> | null {
  let raw: string | null;
  try {
    raw = storage().getItem(SEEN_ROWS_STORAGE_KEY);
  } catch {
    return null;
  }
  const stored = parseSeenRows(raw);
  if (stored) return stored;
  // A device that never showed the list would otherwise flag every old conversation as new.
  const baseline = new Set(currentKeys);
  storeSeenRows(storage, baseline);
  return baseline;
}

/**
 * Records that a conversation was opened.
 * @param storage - The browser's storage.
 * @param seen - The keys seen so far, oldest first.
 * @param key - The conversation that was opened.
 * @returns The new seen set, with the oldest keys dropped past the limit, so a conversation resumed after a long time shows no "new" dot.
 */
export function markSeen(
  storage: SeenStorage,
  seen: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(seen);
  // Re-adding moves the key to the newest end
  next.delete(key);
  next.add(key);
  for (const oldest of next) {
    if (next.size <= SEEN_ROWS_LIMIT) break;
    next.delete(oldest);
  }
  storeSeenRows(storage, next);
  return next;
}
