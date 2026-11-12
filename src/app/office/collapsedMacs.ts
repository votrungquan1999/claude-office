import { z } from "zod";

const COLLAPSED_MACS_STORAGE_KEY = "claude-office.collapsed-macs";

const collapsedMacsSchema = z.array(z.string());

/**
 * Reads the stored list of folded Macs.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The folded machine ids.
 */
export function parseCollapsedMacs(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  // Storage text can be anything the browser kept, so unreadable text folds nothing.
  try {
    const parsed = collapsedMacsSchema.safeParse(JSON.parse(raw));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

/**
 * The folded Macs remembered in this browser.
 * @returns The folded machine ids; empty when storage is unavailable.
 */
export function readCollapsedMacs(): Set<string> {
  try {
    return parseCollapsedMacs(
      window.localStorage.getItem(COLLAPSED_MACS_STORAGE_KEY),
    );
  } catch {
    return new Set();
  }
}

/**
 * Remembers the folded Macs in this browser.
 * @param folded - The folded machine ids.
 */
export function storeCollapsedMacs(folded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(
      COLLAPSED_MACS_STORAGE_KEY,
      JSON.stringify([...folded]),
    );
  } catch {
    // The fold still works for this visit.
  }
}
