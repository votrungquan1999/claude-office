import { useEffect, useRef, useState } from "react";
import { hasArrival } from "./arrivals";
import { type ListFolds, readListFolds, storeListFolds } from "./listFolds";

/** One section the owner can fold. */
export type FoldSection = keyof ListFolds;

/**
 * What is folded in the list: each section (remembered on this device) and the whole list (open at every load).
 * @param needsKeys - The keys of every employee Needs you lists.
 * @param loaded - Whether the first answer is in; before it the set is empty and no key is an arrival.
 * @returns The folds and the ways to change them.
 */
export function useListFolds(needsKeys: ReadonlySet<string>, loaded: boolean) {
  const [folds, setFolds] = useState<ListFolds>(readListFolds);
  const [listOpen, setListOpen] = useState(true);
  const lastKeys = useRef<ReadonlySet<string> | null>(null);
  // The set changes identity on every render, so effects watch its content
  const signature = [...needsKeys].sort().join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for the set's content
  useEffect(() => {
    if (!loaded) return;
    // The first look records what is there; a reload is not an arrival
    if (hasArrival(lastKeys.current, needsKeys)) {
      // Only the Needs you section reopens; the whole-list strip never unfolds on its own
      setFolds((current) => {
        const next = { ...current, needsYou: true };
        storeListFolds(next);
        return next;
      });
    }
    lastKeys.current = needsKeys;
  }, [signature, loaded]);

  /**
   * Opens or closes a section and remembers it.
   * @param section - The section.
   */
  const toggle = (section: FoldSection) =>
    setFolds((current) => {
      const next = { ...current, [section]: !current[section] };
      storeListFolds(next);
      return next;
    });

  return { folds, toggle, listOpen, setListOpen };
}

export type ListFoldState = ReturnType<typeof useListFolds>;
