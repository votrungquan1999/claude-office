import type { Ref } from "react";
import type { CompanyCounts, MacOverview } from "@/shared/overview";

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
}

interface CountSpec {
  room: keyof CompanyCounts;
  label: string;
  color: string;
}

/** The four counts in room order, with the room's own color. */
export const COUNT_SPECS: readonly CountSpec[] = [
  { room: "working", label: "working", color: "var(--color-room-working)" },
  {
    room: "needsPermission",
    label: "needs permission",
    color: "var(--color-room-permission)",
  },
  {
    room: "waitingForYou",
    label: "waiting for you",
    color: "var(--color-room-waiting-for-you)",
  },
  { room: "idle", label: "idle", color: "var(--color-room-idle)" },
];

/**
 * The four counts of a company, each readable on its own.
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
}: CompanyStripProps) {
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
          const shown = folded ? [] : tabs;
          const hidden = tabs.length - shown.length;
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
                className="flex h-40 items-center gap-6 px-8 text-xs text-text-muted"
              >
                <span aria-hidden="true" className="text-[9px]">
                  {folded ? "▶" : "▼"}
                </span>
                {mac.online ? mac.machineName : `${mac.machineName} · offline`}
                {hidden > 0 &&
                  ` · ${hidden} ${hidden === 1 ? "company" : "companies"}`}
              </button>
              {shown.map(({ company, counts, needsYou }) => (
                <button
                  key={company.key}
                  type="button"
                  data-testid="company-tab"
                  data-company-name={company.name}
                  aria-current={
                    company.key === selectedKey ? "page" : undefined
                  }
                  onClick={() => onSelect(company.key)}
                  className={`flex h-40 shrink-0 items-center gap-10 border-2 px-10 text-sm ${company.key === selectedKey ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg hover:bg-btn-hover"}`}
                >
                  <span className="font-bold">{company.name}</span>
                  <CountRow counts={counts} />
                  {needsYou && (
                    <span
                      data-testid="company-badge"
                      className="px-4 text-xs font-bold text-bg-dark"
                      style={{ background: "var(--color-room-permission)" }}
                    >
                      {counts.needsPermission + counts.waitingForYou}
                    </span>
                  )}
                </button>
              ))}
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
          className="h-40 shrink-0 border-2 border-border bg-btn-bg px-10 text-sm hover:bg-btn-hover"
        >
          All companies
        </button>
      </div>
    </nav>
  );
}

export interface CompactCompanyButtonProps {
  /** Every Mac with its companies. */
  macs: MacOverview[];
  /** The viewed company. */
  selectedKey: string | null;
  /** Opens the drawer that lists every company. */
  onOpenDrawer: () => void;
  /** The drawer's trigger, so focus can return to it. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * The strip folded into one button for a sideways phone: the viewed company and how many sessions need the owner anywhere.
 * @param props - The Macs, the viewed company and the drawer trigger.
 * @returns A button that opens the drawer.
 */
export function CompactCompanyButton({
  macs,
  selectedKey,
  onOpenDrawer,
  buttonRef,
}: CompactCompanyButtonProps) {
  const viewed = macs
    .flatMap((mac) => mac.companies)
    .find((entry) => entry.company.key === selectedKey);
  // Only online Macs can really be waiting on the owner.
  const needYou = macs
    .filter((mac) => mac.online)
    .flatMap((mac) => mac.companies)
    .reduce(
      (total, { counts }) =>
        total + counts.needsPermission + counts.waitingForYou,
      0,
    );
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="compact-company-button"
      aria-haspopup="dialog"
      onClick={onOpenDrawer}
      className="absolute top-2 left-2 z-30 flex h-40 max-w-[50%] items-center gap-8 border-2 border-border bg-bg px-10 text-sm hover:bg-btn-hover"
    >
      <span className="truncate font-bold">
        {viewed?.company.name ?? "Companies"}
      </span>
      {needYou > 0 && (
        <span
          data-testid="company-badge"
          className="shrink-0 px-4 text-xs font-bold text-bg-dark"
          style={{ background: "var(--color-room-permission)" }}
        >
          {needYou}
        </span>
      )}
    </button>
  );
}
