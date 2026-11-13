interface FoldedStripProps {
  /** Employees that need the owner, across companies. */
  total: number;
  /** How many of them belong to other companies. */
  inOtherCompanies: number;
  /** Opens the list again. */
  onOpen: () => void;
}

/**
 * The list folded to a thin strip that still counts who needs the owner.
 * @param props - The count and the handler that opens the list.
 * @returns The strip.
 */
export function FoldedStrip({
  total,
  inOtherCompanies,
  onOpen,
}: FoldedStripProps) {
  const others =
    inOtherCompanies > 0
      ? `, ${inOtherCompanies} of them in other companies`
      : "";
  return (
    <button
      type="button"
      data-testid="list-folded-strip"
      aria-label={`${total} need you${others}: open the list`}
      onClick={onOpen}
      className="flex w-[48px] shrink-0 flex-col items-center gap-8 border-l-2 border-border bg-bg-dark py-12 hover:bg-btn-hover"
    >
      <span aria-hidden="true">«</span>
      <span
        aria-hidden="true"
        className={`px-6 text-xs font-bold ${total > 0 ? "bg-room-permission text-bg-dark" : "bg-border text-text-muted"}`}
      >
        ! {total}
      </span>
      <span
        aria-hidden="true"
        className="text-xs text-text-muted [writing-mode:vertical-rl]"
      >
        Needs you
      </span>
    </button>
  );
}
