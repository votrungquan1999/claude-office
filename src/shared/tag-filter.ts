import type { SessionDto } from "./session";
import { tagLabels } from "./tag-labels";

/** Which sessions of a company the owner wants to see. */
export enum TagFilterKind {
  All = "all",
  NoTag = "none",
  Tag = "tag",
}

export interface TagFilterSelection {
  kind: TagFilterKind;
  /** The tag's key when `kind` is `Tag`. */
  key?: string;
}

/** One chip per repo tag. */
export interface TagChip {
  key: string;
  /** The repo name. */
  name: string;
  /** What the chip shows; the same text the employee label shows after its `#`. */
  label: string;
  /** Employees of the company that carry the tag. */
  count: number;
}

export interface TagFilterView {
  /** False when the company has no tags, so there is nothing to filter by. */
  show: boolean;
  /** Employees of the company; the same whichever chip is selected. */
  total: number;
  /** Employees with no tag. */
  noTagCount: number;
  chips: TagChip[];
  /** How each tag key of the company is written, as on the chips. */
  labels: ReadonlyMap<string, string>;
  /** The selection in force: a choice that no longer exists falls back to All. */
  selection: TagFilterSelection;
  /**
   * Whether an employee is shown under the selection.
   * @param session - A session of the company.
   * @returns True when it should be in the office.
   */
  matches(session: SessionDto): boolean;
}

/** The selection that shows everyone. */
export const SHOW_ALL: TagFilterSelection = { kind: TagFilterKind.All };

/**
 * Works out the chips, their counts and who is shown, for one company.
 * @param sessions - Every session of the company, including those that went home.
 * @param selection - What the owner picked.
 * @returns The filter's view.
 */
export function buildTagFilter(
  sessions: SessionDto[],
  selection: TagFilterSelection,
): TagFilterView {
  // Sessions that went home are not in the office, so they count nowhere.
  const employees = sessions.filter((session) => session.state !== "wentHome");
  const byKey = new Map<
    string,
    { name: string; parent?: string; count: number }
  >();
  for (const { tags } of employees) {
    // A session counts once per tag, however often it lists it.
    for (const { name, key, parent } of new Map(
      (tags ?? []).map((tag) => [tag.key, tag]),
    ).values()) {
      byKey.set(key, {
        name,
        parent,
        count: (byKey.get(key)?.count ?? 0) + 1,
      });
    }
  }
  const labels = tagLabels(
    [...byKey].map(([key, { name, parent }]) => ({ name, key, parent })),
  );
  const chips = [...byKey.entries()]
    .map(([key, { name, count }]) => ({
      key,
      name,
      label: labels.get(key) ?? name,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key),
    );
  const noTagCount = employees.filter((s) => !s.tags?.length).length;
  // A tag that vanished, or an empty "no tag", falls back to All.
  const effective =
    (selection.kind === TagFilterKind.Tag &&
      !chips.some((chip) => chip.key === selection.key)) ||
    (selection.kind === TagFilterKind.NoTag && noTagCount === 0)
      ? SHOW_ALL
      : selection;
  const matches = (session: SessionDto): boolean => {
    if (effective.kind === TagFilterKind.NoTag) return !session.tags?.length;
    if (effective.kind === TagFilterKind.Tag) {
      return (session.tags ?? []).some((tag) => tag.key === effective.key);
    }
    return true;
  };
  return {
    show: chips.length > 0,
    total: employees.length,
    noTagCount,
    chips,
    labels,
    selection: effective,
    matches,
  };
}
