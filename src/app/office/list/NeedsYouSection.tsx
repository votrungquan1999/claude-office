import { useState } from "react";
import { CharacterMugShot } from "@/office/components/CharacterMugShot";
import { remoteControlOf } from "@/office/remoteControl";
import { lookOf } from "@/office/sceneSync";
import { employeeName } from "@/shared/employee-name";
import type { NeedsYou } from "@/shared/needs-you";
import { type SessionDto, sessionKey } from "@/shared/session";
import { formatElapsed } from "../elapsed";
import { useNow } from "../useNow";

/** Rows of one group shown before "and N more". */
const GROUP_CAP = 4;

export interface NeedsYouSectionProps {
  needsYou: NeedsYou;
  /** The company being viewed; its rows open without switching company. */
  viewedCompanyKey: string | null;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  /** Opens the card of the original employee; the company is the one the row belongs to. */
  onSelect: (key: string, companyKey: string | null) => void;
  /** Moves a Review employee to Idle. */
  onMoveToIdle: (key: string) => void;
}

/** The badge on a copy's picture, by state. */
const BADGES = {
  needsPermission: { bar: "bg-room-permission", badge: "!" },
  waitingForYou: { bar: "bg-room-waiting-for-you", badge: "…" },
  review: { bar: "bg-room-review", badge: "✓" },
} as const;

/**
 * Copies of every employee that needs the owner, above Everyone.
 * @param props - The selection, the open card and the handlers.
 * @returns The section, or nothing when nobody needs the owner.
 */
export function NeedsYouSection({
  needsYou,
  viewedCompanyKey,
  selectedKey,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
}: NeedsYouSectionProps) {
  // Groups whose "and N more" the owner opened; "own" is the viewed company.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (needsYou.total === 0) return null;
  const groups = [
    { key: "own", companyKey: null, rows: needsYou.own },
    ...needsYou.others.map((group) => ({
      key: group.companyKey,
      companyKey: group.companyKey,
      companyName: group.companyName,
      rows: group.rows,
    })),
  ];
  /**
   * The rows of one group and its "and N more" line.
   * @param group - The group.
   * @returns The rows, capped until the owner expands the group.
   */
  const renderGroup = (group: (typeof groups)[number]) => {
    const open = expanded.has(group.key);
    const visible = open ? group.rows : group.rows.slice(0, GROUP_CAP);
    const hidden = group.rows.length - visible.length;
    return (
      <>
        {visible.map((session) => (
          <NeedsYouRow
            key={`needs:${sessionKey(session)}`}
            session={session}
            selected={sessionKey(session) === selectedKey}
            companyName={"companyName" in group ? group.companyName : undefined}
            serverOffsetMs={serverOffsetMs}
            onMoveToIdle={onMoveToIdle}
            onSelect={() =>
              onSelect(
                sessionKey(session),
                group.companyKey ?? viewedCompanyKey,
              )
            }
          />
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(new Set(expanded).add(group.key))}
              className="w-full px-12 py-6 text-left text-xs text-text-muted hover:bg-btn-hover"
            >
              and {hidden} more
            </button>
          </li>
        )}
      </>
    );
  };
  return (
    <section
      aria-label="Needs you"
      data-testid="needs-you"
      className="flex max-h-[45%] shrink-0 flex-col border-b-2 border-border"
    >
      <div className="flex h-40 shrink-0 items-center gap-8 px-12">
        <span className="font-bold">Needs you</span>
        <span
          data-testid="needs-count"
          className="bg-room-permission px-6 text-xs text-bg-dark"
        >
          {needsYou.total}
        </span>
      </div>
      <ul className="min-h-0 overflow-y-auto">
        {renderGroup(groups[0])}
        {groups.length > 1 && (
          <li className="px-12 pt-6 text-xs text-text-muted uppercase">
            In other companies
          </li>
        )}
        {groups.slice(1).map((group) => (
          <li key={group.key} className="contents">
            <ul className="contents">{renderGroup(group)}</ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface NeedsYouRowProps {
  session: SessionDto;
  selected: boolean;
  /** The company's name, shown as a chip for an employee of another company. */
  companyName?: string;
  serverOffsetMs: number;
  onSelect: () => void;
  onMoveToIdle: (key: string) => void;
}

/**
 * One copy: its picture with the state badge, name, time in state, company chip and link.
 * @param props - The session and the click handler.
 * @returns The row.
 */
function NeedsYouRow({
  session,
  selected,
  companyName,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
}: NeedsYouRowProps) {
  const nowMs = useNow() + serverOffsetMs;
  const key = sessionKey(session);
  const look =
    BADGES[session.state as keyof typeof BADGES] ?? BADGES.waitingForYou;
  const link = remoteControlOf(session);
  const approving = session.state === "needsPermission";
  return (
    <li
      data-testid="needs-row"
      data-key={key}
      aria-current={selected ? "true" : undefined}
      className={`flex items-center gap-8 border-t border-bg-thumb px-8 py-6 ${
        selected
          ? "bg-btn-hover shadow-[inset_4px_0_0_var(--color-accent-bright)]"
          : ""
      }`}
    >
      <span aria-hidden="true" className="relative flex shrink-0">
        <CharacterMugShot {...lookOf(key)} />
        <span
          className={`absolute -top-6 -right-6 flex size-16 items-center justify-center border border-bg-dark text-xs font-bold text-bg-dark ${look.bar}`}
        >
          {look.badge}
        </span>
      </span>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-2 text-left"
      >
        <span
          data-testid="needs-row-name"
          className="truncate text-base font-bold"
        >
          {employeeName(session)}
        </span>
        <span className="flex gap-6 text-xs text-text-muted">
          {session.stateSince && (
            <span>{formatElapsed(nowMs - Date.parse(session.stateSince))}</span>
          )}
          {companyName && (
            <span data-testid="needs-row-company" className="truncate">
              {companyName}
            </span>
          )}
        </span>
      </button>
      {session.state === "review" && (
        <button
          type="button"
          aria-label="Move to Idle"
          onClick={() => onMoveToIdle(key)}
          className="h-30 shrink-0 border-2 border-room-review px-8 text-xs hover:bg-btn-hover"
        >
          Idle
        </button>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            approving ? "Approve in Remote Control" : "Open Remote Control"
          }
          className={`flex h-30 shrink-0 items-center justify-center border-2 border-border px-8 text-xs font-bold ${
            approving
              ? "bg-approve text-bg-dark hover:brightness-110"
              : "bg-btn-bg hover:bg-btn-hover"
          }`}
        >
          {approving ? "Approve" : "Open"} ↗
        </a>
      )}
    </li>
  );
}
