import { useEffect, useRef, useState } from "react";
import { useDeviceSettings } from "../settings/deviceSettings";
import { hasArrival } from "./arrivals";
import { type ListFolds, readListFolds, storeListFolds } from "./listFolds";

/** One section the owner can fold. */
export type FoldSection = keyof ListFolds;

/**
 * What is folded in the list: each section (remembered on this device) and the whole list (open or folded at every load, as the device settings say).
 * @param needsKeys - The keys of every employee Needs you lists.
 * @param existingKeys - The keys of every employee that needs the owner anywhere, listed or not (another company, an offline Mac).
 * @param loaded - Whether the first answer is in; before it the set is empty and no key is an arrival.
 * @returns The folds and the ways to change them.
 */
export function useListFolds(
  needsKeys: ReadonlySet<string>,
  existingKeys: ReadonlySet<string>,
  loaded: boolean,
) {
  const [folds, setFolds] = useState<ListFolds>(readListFolds);
  const { listStart } = useDeviceSettings();
  const [listOpen, setListOpen] = useState(listStart === "open");
  // Picking a start in the settings also opens or folds the list now
  useEffect(() => setListOpen(listStart === "open"), [listStart]);
  const lastExisting = useRef<ReadonlySet<string> | null>(null);
  // The set changes identity on every render, so effects watch its content
  const signature = [...needsKeys].sort().join("|");
  const existingSignature = [...existingKeys].sort().join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: the signatures stand for the sets' content
  useEffect(() => {
    if (!loaded) return;
    // The first look records what is there; a reload is not an arrival
    // Listed employees that were not waiting anywhere at the last look are new; a Mac coming back, a company switch or a setting that adds rows leaves them in the earlier set
    if (hasArrival(lastExisting.current, needsKeys)) {
      // Only the Needs you section reopens; the whole-list strip never unfolds on its own
      setFolds((current) => {
        const next = { ...current, needsYou: true };
        storeListFolds(next);
        return next;
      });
    }
    lastExisting.current = existingKeys;
  }, [signature, existingSignature, loaded]);

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
