import type { EmployeeMatch, MatchField } from "@/shared/employee-search";

const LABELS: Record<MatchField, string> = {
  name: "Name",
  automatic: "Automatic name",
  tab: "Tab name",
  request: "First request",
  step: "Last step",
};

/**
 * One line saying where a search matched, with the matched words picked out.
 * @param props - The match.
 * @returns The line; the text comes from conversations, so it is only ever rendered as text.
 */
export function MatchWhy({ match }: { match: EmployeeMatch }) {
  const { pre, hit, post } = match.snippet;
  return (
    <span className="block truncate text-xs text-text-muted">
      <span className="font-bold">{LABELS[match.field]}: </span>
      {pre}
      <mark className="bg-transparent font-bold text-accent-bright">{hit}</mark>
      {post}
    </span>
  );
}
