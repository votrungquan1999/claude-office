interface DropsHereGapProps {
  /** Where the dashed slot starts, in the list's own coordinates. */
  top: number;
  /** As tall as the dragged row. */
  height: number;
}

/**
 * The dashed slot that shows where a dragged row will land.
 * @param props - Where the slot is and how tall.
 * @returns The slot, laid over the list.
 */
export function DropsHereGap({ top, height }: DropsHereGapProps) {
  return (
    <li
      aria-hidden="true"
      style={{ top, height }}
      className="pointer-events-none absolute right-8 left-20 flex items-center justify-center border-2 border-dashed border-accent-bright bg-accent-bright/10 text-xs"
    >
      Drops here
    </li>
  );
}
