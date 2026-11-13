import { z } from "zod";

/** Which sections of the list are open. */
export interface ListFolds {
  needsYou: boolean;
  everyone: boolean;
  wentHome: boolean;
}

const DEFAULT_FOLDS: ListFolds = {
  needsYou: true,
  everyone: true,
  wentHome: false,
};

const LIST_FOLDS_STORAGE_KEY = "claude-office.list-folds";

// A field that is missing or of the wrong type takes its default
const foldsSchema = z.object({
  needsYou: z.boolean().catch(DEFAULT_FOLDS.needsYou),
  everyone: z.boolean().catch(DEFAULT_FOLDS.everyone),
  wentHome: z.boolean().catch(DEFAULT_FOLDS.wentHome),
});

/**
 * Reads the stored section folds.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The folds; every field the text does not hold readably keeps its default.
 */
export function parseListFolds(raw: string | null): ListFolds {
  if (raw === null) return DEFAULT_FOLDS;
  // Storage text can be anything the browser kept
  try {
    const fields = foldsSchema.safeParse(JSON.parse(raw));
    return fields.success ? fields.data : DEFAULT_FOLDS;
  } catch {
    return DEFAULT_FOLDS;
  }
}

/**
 * The folds remembered in this browser.
 * @returns The folds; the defaults when storage is unavailable.
 */
export function readListFolds(): ListFolds {
  try {
    return parseListFolds(window.localStorage.getItem(LIST_FOLDS_STORAGE_KEY));
  } catch {
    return DEFAULT_FOLDS;
  }
}

/**
 * Remembers the folds in this browser.
 * @param folds - Which sections are open.
 */
export function storeListFolds(folds: ListFolds): void {
  try {
    window.localStorage.setItem(LIST_FOLDS_STORAGE_KEY, JSON.stringify(folds));
  } catch {
    // The fold still works for this visit.
  }
}
