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
  /** Which rows the section lists: this company's, or the other companies'. */
  scope?: "own" | "others";
  needsYou: NeedsYou;
  /** The company being viewed; its rows open without switching company. */
  viewedCompanyKey: string | null;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  /** Opens the card of the original employee; the company is the one the row belongs to. */
  onSelect: (key: string, companyKey: string | null) => void;
  /** Moves a Review or Waiting for you employee to Idle. */
  onMoveToIdle: (key: string) => void;
  /** Whether the rows show; the header stays either way. */
  open: boolean;
  onToggle: () => void;
  /** On a phone: touch-sized buttons, and the section never scrolls on its own because the list around it does. */
  phone?: boolean;
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
  scope = "own",
  needsYou,
  viewedCompanyKey,
  selectedKey,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  open: sectionOpen,
  onToggle,
  phone = false,
}: NeedsYouSectionProps) {
  // Groups whose "and N more" the owner opened; "own" is the viewed company.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const others = scope === "others";
  const groups = others
    ? needsYou.others.map((group) => ({
        key: group.companyKey,
        companyKey: group.companyKey as string | null,
        companyName: group.companyName as string | undefined,
        rows: group.rows,
      }))
    : [
        {
          key: "own",
          companyKey: null as string | null,
          companyName: undefined as string | undefined,
          rows: needsYou.own,
        },
      ];
  const label = others ? "In other companies" : "Needs you";
  const prefix = others ? "other-companies" : "needs-you";
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (count === 0) return null;
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
            companyName={group.companyName}
            serverOffsetMs={serverOffsetMs}
            phone={phone}
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
              className={`w-full px-12 text-left text-xs text-text-muted hover:bg-btn-hover ${phone ? "min-h-44" : "py-6"}`}
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
      aria-label={label}
      data-testid={prefix}
      // On a desktop it gives up height first, down to its header, so Everyone below is never squashed; its rows scroll
      className={`flex flex-col border-b-2 border-border ${phone ? "shrink-0" : "max-h-[45%] min-h-42"}`}
    >
      <div
        className={`flex shrink-0 items-center gap-8 px-12 ${phone ? "min-h-44" : "h-40"}`}
      >
        <button
          type="button"
          aria-expanded={sectionOpen}
          aria-controls={`${prefix}-rows`}
          onClick={onToggle}
          className={`flex items-center gap-8 ${phone ? "self-stretch" : ""}`}
        >
          <span aria-hidden="true" className="text-xs">
            {sectionOpen ? "▼" : "▶"}
          </span>
          <span className="font-bold">{label}</span>
        </button>
        <span
          data-testid={others ? "other-companies-count" : "needs-count"}
          className="bg-room-permission px-6 text-xs text-bg-dark"
        >
          {count}
        </span>
      </div>
      <ul
        id={`${prefix}-rows`}
        hidden={!sectionOpen}
        className={phone ? "" : "min-h-0 overflow-y-auto"}
      >
        {groups.map((group) => (
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
  phone: boolean;
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
  phone,
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
        className={`flex min-w-0 flex-1 flex-col justify-center gap-2 text-left ${phone ? "min-h-44" : ""}`}
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
      {(session.state === "review" || session.state === "waitingForYou") && (
        <button
          type="button"
          aria-label="Move to Idle"
          onClick={() => onMoveToIdle(key)}
          className={`shrink-0 border-2 border-room-review px-8 text-xs hover:bg-btn-hover ${phone ? "h-44 min-w-44" : "h-30"}`}
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
          className={`flex shrink-0 items-center justify-center border-2 border-border px-8 text-xs font-bold ${phone ? "h-44 min-w-44" : "h-30"} ${
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
