import { useState } from "react";
import { loadSeenRows, markSeen } from "./seenRows";

/**
 * The conversations this device has opened or already had when it first showed the list.
 * @returns The seen set (null until the first answer, or when storage is unavailable), and how to fill and extend it.
 */
export function useSeenRows() {
  const [seenKeys, setSeenKeys] = useState<ReadonlySet<string> | null>(null);
  return {
    seenKeys,
    /** Sets the baseline from the first answer's session keys. */
    load: (currentKeys: readonly string[]) =>
      setSeenKeys(loadSeenRows(() => window.localStorage, currentKeys)),
    /** Records that the conversation was opened. */
    open: (key: string) => {
      if (seenKeys && !seenKeys.has(key))
        setSeenKeys(markSeen(() => window.localStorage, seenKeys, key));
    },
  };
}
