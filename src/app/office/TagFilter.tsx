import { useEffect, useRef, useState } from "react";
import {
  TagFilterKind,
  type TagFilterSelection,
  type TagFilterView,
} from "@/shared/tag-filter";

export interface TagFilterProps {
  view: TagFilterView;
  /** True while a drawer or the details card is open; the panel closes. */
  covered?: boolean;
  /** Show the panel as a bottom sheet with a Close button, as on a touch screen. */
  sheet?: boolean;
  /** Called whenever the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  onSelect: (selection: TagFilterSelection) => void;
}

interface ChipProps {
  label: string;
  count: number;
  pressed: boolean;
  testId: string;
  /** The tag's key, for a tag chip. */
  tagKey?: string;
  /** In the touch sheet, where a chip is a full-size tap target. */
  tall: boolean;
  onClick: () => void;
}

/**
 * One chip of the filter.
 * @param props - Its text, count and state.
 * @returns A toggle button.
 */
function Chip({
  label,
  count,
  pressed,
  testId,
  tagKey,
  tall,
  onClick,
}: ChipProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-tag-key={tagKey}
      aria-pressed={pressed}
      onClick={onClick}
      className={`${tall ? "min-h-[44px]" : "h-40"} border-2 px-10 text-sm ${pressed ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg hover:bg-btn-hover"}`}
    >
      {`${label} ${count}`}
    </button>
  );
}

/**
 * What the pill reads: the pick and how many employees it shows.
 * @param view - The filter's view.
 * @returns The label and the count text.
 */
function pillOf(view: TagFilterView): { label: string; count: string } {
  const { selection } = view;
  if (selection.kind === TagFilterKind.NoTag) {
    return { label: "No tag", count: `${view.noTagCount} of ${view.total}` };
  }
  if (selection.kind === TagFilterKind.Tag) {
    const chip = view.chips.find((entry) => entry.key === selection.key);
    if (chip) {
      return {
        label: `#${chip.label}`,
        count: `${chip.count} of ${view.total}`,
      };
    }
  }
  return { label: "All repos", count: String(view.total) };
}

/**
 * The repo-tag filter: a pill with the chips behind it.
 * @param props - The view to show and the pick handler.
 * @returns The pill, or nothing when the company has no tags.
 */
export function TagFilter({
  view,
  onSelect,
  covered,
  sheet = false,
  onOpenChange,
}: TagFilterProps) {
  const [open, setOpen] = useState(false);

  // The parent hides what the sheet would sit over, such as the phone bottom bar.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const pillRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Without chips the pill is gone, so an open sheet would hide the bar for good.
  useEffect(() => {
    if (!view.show) setOpen(false);
  }, [view.show]);

  // A modal sheet takes focus, as a dialog should.
  useEffect(() => {
    if (open && sheet) closeRef.current?.focus();
  }, [open, sheet]);

  const closeSheet = () => {
    setOpen(false);
    pillRef.current?.focus();
  };

  // A drawer or card opened by keyboard has no outside press to close the panel.
  useEffect(() => {
    if (covered) setOpen(false);
  }, [covered]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      pillRef.current?.focus();
    };
    const onPress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  if (!view.show) return null;
  const { selection } = view;
  const filtered = selection.kind !== TagFilterKind.All;
  const pill = pillOf(view);
  const pick = (next: TagFilterSelection) => {
    onSelect(next);
    setOpen(false);
  };
  const chips = (
    <>
      <Chip
        label="All"
        count={view.total}
        pressed={selection.kind === TagFilterKind.All}
        testId="tag-chip-all"
        tall={sheet}
        onClick={() => pick({ kind: TagFilterKind.All })}
      />
      {view.chips.map((chip) => (
        <Chip
          key={chip.key}
          label={chip.label}
          count={chip.count}
          pressed={
            selection.kind === TagFilterKind.Tag && selection.key === chip.key
          }
          testId="tag-chip"
          tall={sheet}
          tagKey={chip.key}
          onClick={() => pick({ kind: TagFilterKind.Tag, key: chip.key })}
        />
      ))}
      {view.noTagCount > 0 && (
        <Chip
          label="No tag"
          count={view.noTagCount}
          pressed={selection.kind === TagFilterKind.NoTag}
          testId="tag-chip-none"
          tall={sheet}
          onClick={() => pick({ kind: TagFilterKind.NoTag })}
        />
      )}
    </>
  );
  return (
    <div
      ref={rootRef}
      data-testid="tag-filter"
      className="flex max-w-full min-w-0 flex-col items-start gap-6"
    >
      <div className="flex max-w-full min-w-0">
        <button
          ref={pillRef}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className={`flex min-h-[44px] items-center gap-8 border-2 px-12 text-sm shadow-[3px_3px_0_#000] min-w-0 ${filtered || open ? "border-accent-bright" : "border-border"} ${filtered ? "bg-active-bg" : "bg-bg-dark"}`}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 2h12L8 8v4l-2 1V8z" />
          </svg>
          <span className="truncate">{pill.label}</span>{" "}
          <span className="shrink-0 text-xs text-text-muted">{pill.count}</span>
        </button>
        {filtered && (
          <button
            type="button"
            aria-label="Show all repos"
            onClick={() => pick({ kind: TagFilterKind.All })}
            className="min-h-[44px] min-w-[44px] border-2 border-l-0 border-accent-bright bg-active-bg shadow-[3px_3px_0_#000]"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {open && sheet && (
        <div
          aria-hidden="true"
          data-testid="tag-filter-scrim"
          onClick={closeSheet}
          className="fixed inset-0 z-[69] bg-black/50"
        />
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Filter by repo"
          aria-modal={sheet ? "true" : undefined}
          className={
            sheet
              ? "fixed inset-x-0 bottom-0 z-[70] flex max-h-[70%] flex-col gap-10 overflow-y-auto border-2 border-x-0 border-b-0 border-accent-bright bg-bg-dark p-12 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              : "flex w-[420px] max-w-[calc(100vw-1rem)] flex-col gap-10 border-2 border-accent-bright bg-bg-dark p-12 shadow-[4px_4px_0_#000]"
          }
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Show employees who worked in
            </span>
            {sheet && (
              <button
                ref={closeRef}
                type="button"
                onClick={closeSheet}
                className="min-h-[44px] min-w-[44px] border-2 border-border bg-btn-bg px-10 text-sm"
              >
                Close
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-6">{chips}</div>
        </div>
      )}
    </div>
  );
}
