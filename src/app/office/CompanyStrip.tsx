import { type Ref, useEffect, useRef, useState } from "react";
import { ROOM_COLORS, Room } from "@/office/rooms";
import { needsYouCount } from "@/shared/needs-you";
import type { CompanyCounts, MacOverview } from "@/shared/overview";
import { renameToSend } from "./renameRule";

export interface CompanyStripProps {
  /** Every Mac with its companies. */
  macs: MacOverview[];
  /** The viewed company; its tab shows even when nothing is live in it. */
  selectedKey: string | null;
  onSelect: (companyKey: string) => void;
  /** Opens the drawer that lists every company. */
  onOpenDrawer: () => void;
  /** The drawer's trigger, so focus can return to it. */
  drawerButtonRef?: Ref<HTMLButtonElement>;
  /** Macs whose group is folded to one label. */
  collapsedMacs: ReadonlySet<string>;
  /** Asks to fold or open a Mac's group. */
  onToggleMac: (machineId: string) => void;
  /** Asks to name a company; null puts the folder name back. */
  onRename?: (
    machineId: string,
    path: string,
    displayName: string | null,
  ) => void;
  /** Whether a double-click on a tab opens the name editor; true only with a mouse. */
  renamable?: boolean;
  /** A real phone: tabs show the name and the needs-you badge only, and All companies is an icon. */
  phone?: boolean;
}

interface CountSpec {
  room: keyof CompanyCounts;
  label: string;
  color: string;
}

/** The five counts in room order, with the room's own color. */
export const COUNT_SPECS: readonly CountSpec[] = [
  { room: "working", label: "working", color: ROOM_COLORS[Room.Working] },
  {
    room: "needsPermission",
    label: "needs permission",
    color: ROOM_COLORS[Room.NeedsPermission],
  },
  {
    room: "waitingForYou",
    label: "waiting for you",
    color: ROOM_COLORS[Room.WaitingForYou],
  },
  { room: "review", label: "review", color: ROOM_COLORS[Room.Review] },
  { room: "idle", label: "idle", color: ROOM_COLORS[Room.Idle] },
];

/**
 * The five counts of a company, each readable on its own.
 * @param props - The counts.
 * @returns A row of colored numbers; a zero is dimmed.
 */
export function CountRow({ counts }: { counts: CompanyCounts }) {
  return (
    <span className="flex items-center gap-6 text-xs">
      {COUNT_SPECS.map(({ room, label, color }) => (
        <span
          key={room}
          role="img"
          aria-label={`${counts[room]} ${label}`}
          className="flex items-center gap-2"
          style={{ opacity: counts[room] === 0 ? 0.4 : 1 }}
        >
          <span
            aria-hidden="true"
            className="inline-block h-8 w-8"
            style={{ background: color }}
          />
          <span aria-hidden="true">{counts[room]}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * The always-on strip above the office: per Mac, one tab per active company with its four counts.
 * @param props - The overview and the viewed company.
 * @returns The strip.
 */
export function CompanyStrip({
  macs,
  selectedKey,
  onSelect,
  onOpenDrawer,
  drawerButtonRef,
  collapsedMacs,
  onToggleMac,
  onRename,
  renamable = false,
  phone = false,
}: CompanyStripProps) {
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(
    null,
  );
  // The blur that follows Enter or Escape must not save a second time.
  const finished = useRef(false);
  const knownKeys = new Set(
    macs.flatMap((mac) => mac.companies.map((entry) => entry.company.key)),
  );
  // A company that disappears while it is being named takes its editor with it.
  const editingGone = editing !== null && !knownKeys.has(editing.key);
  useEffect(() => {
    if (editingGone) setEditing(null);
  }, [editingGone]);
  return (
    <nav
      aria-label="Companies"
      data-testid="company-strip"
      className="flex h-56 w-full shrink-0 items-stretch whitespace-nowrap border-b-2 border-border bg-bg-dark"
    >
      {/* Only the tabs scroll, so All companies never leaves the bar's edge. */}
      <div
        data-testid="company-tabs"
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-12 overflow-x-auto overflow-y-hidden px-8"
      >
        {macs.flatMap((mac) => {
          const tabs = mac.companies.filter(
            (entry) => entry.active || entry.company.key === selectedKey,
          );
          if (tabs.length === 0) return [];
          const folded = collapsedMacs.has(mac.machineId);
          // A folded Mac still shows the company being viewed.
          const shown = folded
            ? tabs.filter((entry) => entry.company.key === selectedKey)
            : tabs;
          const hiddenTabs = tabs.filter((entry) => !shown.includes(entry));
          const hidden = hiddenTabs.length;
          // Only companies that need the owner on an online Mac add to the badge.
          const hiddenNeeds = hiddenTabs
            .filter((entry) => entry.needsYou)
            .reduce((total, { counts }) => total + needsYouCount(counts), 0);
          return (
            <div
              key={mac.machineId}
              data-testid={`mac-group-${mac.machineId}`}
              data-offline={String(!mac.online)}
              className="flex shrink-0 items-center gap-8"
              style={{ opacity: mac.online ? 1 : 0.5 }}
            >
              <button
                type="button"
                data-testid={`mac-toggle-${mac.machineId}`}
                aria-expanded={!folded}
                onClick={() => onToggleMac(mac.machineId)}
                className={`flex items-center gap-6 px-8 text-xs text-text-muted ${phone ? "min-h-[44px]" : "h-40"}`}
              >
                <span aria-hidden="true" className="text-[9px]">
                  {folded ? "▶" : "▼"}
                </span>
                {mac.online ? mac.machineName : `${mac.machineName} · offline`}
                {hidden > 0 &&
                  ` · ${hidden} ${hidden === 1 ? "company" : "companies"}`}
              </button>
              {hiddenNeeds > 0 && (
                <span
                  data-testid={`mac-badge-${mac.machineId}`}
                  className="px-4 text-xs font-bold text-bg-dark"
                  style={{ background: "var(--color-room-permission)" }}
                >
                  {hiddenNeeds}
                </span>
              )}
              {shown.map(({ company, counts, needsYou }) => {
                const { path } = company;
                if (editing?.key === company.key && path !== null) {
                  const finish = (save: boolean) => {
                    if (finished.current) return;
                    finished.current = true;
                    setEditing(null);
                    const request = save
                      ? renameToSend(editing.draft, company)
                      : null;
                    if (request) {
                      onRename?.(company.machineId, path, request.displayName);
                    }
                  };
                  return (
                    <div
                      key={company.key}
                      className="flex h-40 shrink-0 items-center gap-8 border-2 border-accent-bright bg-active-bg px-10 text-sm"
                    >
                      <input
                        // biome-ignore lint/a11y/noAutofocus: the editor opens from the owner's double-click on its tab
                        autoFocus
                        aria-label={`Name for folder ${company.folderName}`}
                        maxLength={100}
                        value={editing.draft}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          setEditing({
                            key: company.key,
                            draft: event.target.value,
                          })
                        }
                        onBlur={() => finish(true)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            finish(true);
                          } else if (event.key === "Escape") {
                            event.stopPropagation();
                            finish(false);
                          }
                        }}
                        className="w-[160px] border-2 border-border bg-bg-dark px-6 text-sm text-text"
                      />
                      <span className="text-xs text-text-muted">
                        Enter saves · Esc cancels
                      </span>
                    </div>
                  );
                }
                return (
                  <button
                    key={company.key}
                    type="button"
                    data-testid="company-tab"
                    data-company-name={company.name}
                    title={company.name}
                    aria-current={
                      company.key === selectedKey ? "page" : undefined
                    }
                    // The save that follows re-sorts the tabs under the pointer and can swallow the click, so another tab is picked on press.
                    onPointerDown={() => {
                      if (editing) onSelect(company.key);
                    }}
                    onClick={() => onSelect(company.key)}
                    onDoubleClick={() => {
                      if (!renamable || path === null) return;
                      finished.current = false;
                      setEditing({ key: company.key, draft: company.name });
                    }}
                    className={`flex shrink-0 items-center gap-10 border-2 px-10 text-sm ${phone ? "min-h-[44px]" : "h-40"} ${company.key === selectedKey ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg hover:bg-btn-hover"}`}
                  >
                    <span
                      className={`truncate font-bold ${phone ? "max-w-[140px]" : "max-w-[200px]"}`}
                    >
                      {company.name}
                    </span>
                    {!phone && <CountRow counts={counts} />}
                    {needsYou && (
                      <span
                        data-testid="company-badge"
                        className="px-4 text-xs font-bold text-bg-dark"
                        style={{ background: "var(--color-room-permission)" }}
                      >
                        {needsYouCount(counts)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center border-l-2 border-border px-8">
        <button
          ref={drawerButtonRef}
          type="button"
          data-testid="open-drawer"
          aria-haspopup="dialog"
          onClick={onOpenDrawer}
          aria-label={phone ? "All companies" : undefined}
          className={`shrink-0 border-2 border-border bg-btn-bg text-sm hover:bg-btn-hover ${phone ? "grid min-h-[44px] min-w-[44px] place-items-center" : "h-40 px-10"}`}
        >
          {phone ? (
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="1" y="1" width="5" height="5" />
              <rect x="10" y="1" width="5" height="5" />
              <rect x="1" y="10" width="5" height="5" />
              <rect x="10" y="10" width="5" height="5" />
            </svg>
          ) : (
            "All companies"
          )}
        </button>
      </div>
    </nav>
  );
}
