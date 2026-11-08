import {
  TagFilterKind,
  type TagFilterSelection,
  type TagFilterView,
} from "@/shared/tag-filter";

export interface TagFilterProps {
  view: TagFilterView;
  onSelect: (selection: TagFilterSelection) => void;
}

interface ChipProps {
  label: string;
  count: number;
  pressed: boolean;
  testId: string;
  /** The tag's key, for a tag chip. */
  tagKey?: string;
  onClick: () => void;
}

/**
 * One chip of the filter.
 * @param props - Its text, count and state.
 * @returns A toggle button.
 */
function Chip({ label, count, pressed, testId, tagKey, onClick }: ChipProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-tag-key={tagKey}
      aria-pressed={pressed}
      onClick={onClick}
      className={`h-40 shrink-0 border-2 px-10 text-sm ${pressed ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg hover:bg-btn-hover"}`}
    >
      {`${label} ${count}`}
    </button>
  );
}

/**
 * The repo-tag filter: All, each tag with its count, and no tag.
 * @param props - The view to show and the pick handler.
 * @returns A row of chips, or nothing when the company has no tags.
 */
export function TagFilter({ view, onSelect }: TagFilterProps) {
  if (!view.show) return null;
  const { selection } = view;
  return (
    <fieldset
      aria-label="Filter by repo tag"
      data-testid="tag-filter"
      className="m-0 flex min-w-0 shrink-0 items-center gap-8 border-0 p-0"
    >
      <Chip
        label="All"
        count={view.total}
        pressed={selection.kind === TagFilterKind.All}
        testId="tag-chip-all"
        onClick={() => onSelect({ kind: TagFilterKind.All })}
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
          tagKey={chip.key}
          onClick={() => onSelect({ kind: TagFilterKind.Tag, key: chip.key })}
        />
      ))}
      {view.noTagCount > 0 && (
        <Chip
          label="No tag"
          count={view.noTagCount}
          pressed={selection.kind === TagFilterKind.NoTag}
          testId="tag-chip-none"
          onClick={() => onSelect({ kind: TagFilterKind.NoTag })}
        />
      )}
    </fieldset>
  );
}
