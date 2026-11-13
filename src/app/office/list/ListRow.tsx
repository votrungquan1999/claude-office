import { useSortable } from "@dnd-kit/sortable";
import { useEffect, useRef } from "react";
import { CharacterMugShot } from "@/office/components/CharacterMugShot";
import { remoteControlUrl } from "@/office/remoteControl";
import { lookOf } from "@/office/sceneSync";
import { employeeName } from "@/shared/employee-name";
import { type SessionDto, sessionKey } from "@/shared/session";
import { formatElapsed } from "../elapsed";
import { type BandKey, bandOf, contextLineOf } from "../rowText";
import { useNow } from "../useNow";

export interface ListRowProps {
  session: SessionDto;
  /** Whether a mouse can drag this row to a new place. */
  draggable: boolean;
  /** Whether this conversation arrived after this device first showed the list and has not been opened yet. */
  isNew: boolean;
  /** Whether this is the employee whose card is open. */
  selected: boolean;
  /** Changes each time the owner picks this employee in the office, so its row scrolls into view; null otherwise. */
  revealToken: number | null;
  /** Whether the session's Mac is offline. */
  offline: boolean;
  /** How each repo tag of the viewed company is written, by tag key. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  /** Opens the employee's card and selects it in the office. */
  onSelect: (key: string) => void;
  /** Moves the employee's Review to Idle. */
  onMoveToIdle: (key: string) => void;
  /** Asks for the rename dialog of this employee. */
  onRequestRename: (key: string) => void;
}

/** The colours of a row's state bar and word. */
interface RowStyle {
  bar: string;
  text: string;
  /** What the badge on the picture says; none for a state that needs nothing from the owner. */
  badge?: string;
}

const ROW_STYLES = {
  working: { bar: "bg-room-working", text: "text-room-working" },
  thinking: { bar: "bg-room-working", text: "text-room-working" },
  needsPermission: {
    bar: "bg-room-permission",
    text: "text-room-permission",
    badge: "!",
  },
  waitingForYou: {
    bar: "bg-room-waiting-for-you",
    text: "text-room-waiting-for-you",
    badge: "…",
  },
  review: { bar: "bg-room-review", text: "text-room-review", badge: "✓" },
  idle: { bar: "bg-room-idle", text: "text-room-idle" },
  wentHome: { bar: "bg-pill-offline", text: "text-text-muted" },
  offline: { bar: "bg-pill-offline", text: "text-text-muted" },
  notRunning: { bar: "bg-pill-offline", text: "text-text-muted" },
  waitingAtMac: { bar: "bg-room-permission", text: "text-room-permission" },
  starting: { bar: "bg-room-idle", text: "text-room-idle" },
} satisfies Record<BandKey, RowStyle>;

/** Tag chips shown on a row before the rest fold into "+N". */
const SHOWN_TAGS = 1;

/**
 * One employee in the list: its picture, name, state word, time, context line and buttons.
 * @param props - The session and the handlers.
 * @returns The row.
 */
export function ListRow({
  session,
  draggable,
  isNew,
  selected,
  revealToken,
  offline,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  onRequestRename,
}: ListRowProps) {
  // The clock lives in the row, so only the rows re-render every second.
  const nowMs = useNow() + serverOffsetMs;
  const rowRef = useRef<HTMLLIElement>(null);
  const sortable = useSortable({
    id: sessionKey(session),
    disabled: !draggable,
  });
  // Keeps the row in sight after a pick in the office; a pick in the list must not move it under the pointer.
  useEffect(() => {
    if (revealToken !== null)
      rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [revealToken]);
  const key = sessionKey(session);
  const name = employeeName(session);
  const band = bandOf(session, offline);
  const style: RowStyle = ROW_STYLES[band.key];
  const context = contextLineOf(session, offline);
  // A Mac that is offline says nothing about how long the session has been in its state.
  const inState =
    (offline && !session.notRunning) || !session.stateSince
      ? null
      : formatElapsed(nowMs - Date.parse(session.stateSince));
  const rest = [inState, context].filter(Boolean).join(" · ");
  // A window with no process, or still opening, has nothing to link to.
  const linkable = !(
    session.notRunning ||
    session.waitingAtMac ||
    session.starting
  );
  const remoteControl = linkable
    ? remoteControlUrl(session.bridgeSessionId)
    : null;
  const approving = session.state === "needsPermission" && !offline;
  const tags = session.tags ?? [];
  // A positioned row with its own background paints over the rows it passes; without them its neighbours show through.
  const rowLook = sortable.isDragging
    ? "relative z-10 bg-btn-bg outline-2 outline-accent-bright shadow-[6px_6px_0_var(--color-bg-dark)]"
    : selected
      ? "bg-btn-hover shadow-[inset_4px_0_0_var(--color-accent-bright)]"
      : "";
  return (
    <li
      ref={(node) => {
        rowRef.current = node;
        sortable.setNodeRef(node);
      }}
      style={{
        transform: sortable.transform
          ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
          : undefined,
        transition: sortable.transition,
      }}
      {...sortable.listeners}
      data-testid="list-row"
      data-key={key}
      aria-current={selected ? "true" : undefined}
      className={`flex items-stretch gap-8 border-b border-bg-thumb px-8 py-8 ${offline ? "opacity-60" : ""} ${rowLook}`}
    >
      {draggable && (
        <span
          role="img"
          aria-label="Drag to reorder"
          aria-describedby={sortable.attributes["aria-describedby"]}
          title="Drag to reorder"
          className="flex w-18 shrink-0 cursor-grab items-center justify-center text-text-muted"
        >
          <svg
            aria-hidden="true"
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="currentColor"
          >
            <rect x="0" y="0" width="3" height="3" />
            <rect x="5" y="0" width="3" height="3" />
            <rect x="0" y="5.5" width="3" height="3" />
            <rect x="5" y="5.5" width="3" height="3" />
            <rect x="0" y="11" width="3" height="3" />
            <rect x="5" y="11" width="3" height="3" />
          </svg>
        </span>
      )}
      <span aria-hidden="true" className={`w-4 shrink-0 ${style.bar}`} />
      <span
        aria-hidden="true"
        className="relative flex shrink-0 items-center self-center"
      >
        <CharacterMugShot {...lookOf(key)} />
        {style.badge && (
          <span
            className={`absolute -top-6 -right-6 flex size-16 items-center justify-center border border-bg-dark text-xs font-bold text-bg-dark ${style.bar}`}
          >
            {style.badge}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onSelect(key)}
        className="flex min-w-0 flex-1 flex-col gap-4 text-left"
      >
        <span className="flex w-full items-start gap-6">
          {isNew && (
            <span
              role="img"
              aria-label="new"
              data-testid="list-row-new"
              className="mt-4 size-8 shrink-0 bg-accent-bright"
            />
          )}
          <span
            data-testid="list-row-name"
            className="line-clamp-2 min-w-0 flex-1 text-base leading-[1.15] font-bold break-words"
          >
            {name}
          </span>
          {tags.length > 0 && (
            <span className="flex shrink-0 gap-4 text-xs">
              {tags.slice(0, SHOWN_TAGS).map((tag) => (
                <span
                  key={tag.key}
                  data-testid="list-row-tag"
                  className="max-w-[112px] truncate bg-bg-thumb px-4"
                >
                  #{tagLabels.get(tag.key) ?? tag.name}
                </span>
              ))}
              {tags.length > SHOWN_TAGS && (
                <span className="bg-bg-thumb px-4">
                  +{tags.length - SHOWN_TAGS}
                </span>
              )}
            </span>
          )}
        </span>
        <span data-testid="list-row-status" className="w-full truncate text-xs">
          <span className={style.text}>{band.text}</span>
          {rest && <span className="text-text-muted"> · {rest}</span>}
        </span>
      </button>
      {session.state === "review" && (
        <button
          type="button"
          aria-label="Move to Idle"
          onClick={() => onMoveToIdle(key)}
          className="h-30 shrink-0 self-center border-2 border-room-review px-8 text-xs hover:bg-btn-hover"
        >
          Idle
        </button>
      )}
      <button
        type="button"
        aria-label={`Rename ${name}`}
        onClick={() => onRequestRename(key)}
        className="size-30 shrink-0 self-center border-2 border-border bg-btn-bg hover:bg-btn-hover"
      >
        ✎
      </button>
      {remoteControl && (
        <a
          href={remoteControl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            approving ? "Approve in Remote Control" : "Open Remote Control"
          }
          className={`flex size-30 shrink-0 items-center justify-center self-center border-2 border-border ${
            approving
              ? "bg-approve text-bg-dark hover:brightness-110"
              : "bg-btn-bg hover:bg-btn-hover"
          }`}
        >
          ↗
        </a>
      )}
    </li>
  );
}
