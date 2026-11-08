import { useEffect } from "react";
import type { Overview } from "@/shared/overview";
import { CountRow } from "./CompanyStrip";

export interface CompanyDrawerProps {
  overview: Overview;
  /** The viewed company. */
  selectedKey: string | null;
  /** Full-width sheet on a phone; a side panel elsewhere. */
  sheet: boolean;
  onSelect: (companyKey: string) => void;
  onClose: () => void;
}

/**
 * Every Mac and every company with the same four counts as the strip.
 * @param props - The overview, the viewed company and the handlers.
 * @returns The drawer dialog.
 */
export function CompanyDrawer({
  overview,
  selectedKey,
  sheet,
  onSelect,
  onClose,
}: CompanyDrawerProps) {
  // Escape closes the drawer wherever focus is, so the listener sits on the document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  // Only online Macs can really be waiting on the owner.
  const elsewhere = overview.macs
    .filter((mac) => mac.online)
    .flatMap((mac) => mac.companies)
    .filter((entry) => entry.company.key !== selectedKey)
    .reduce(
      (total, { counts }) =>
        total + counts.needsPermission + counts.waitingForYou,
      0,
    );
  return (
    <div
      role="dialog"
      aria-label="All companies"
      className={`absolute z-[70] flex flex-col gap-8 overflow-y-auto border-2 border-border bg-bg p-12 text-sm ${
        sheet
          ? "inset-x-0 bottom-0 max-h-[85%] border-x-0 border-b-0"
          : "top-0 right-0 bottom-0 w-[420px] max-w-full"
      }`}
    >
      <div className="flex items-center justify-between gap-8">
        <h2 className="text-lg font-bold">Companies</h2>
        <button
          type="button"
          aria-label="Close"
          // Focus moves into the dialog when it opens.
          // biome-ignore lint/a11y/noAutofocus: a dialog moves focus into itself
          autoFocus
          onClick={onClose}
          className="shrink-0 px-8 text-lg leading-none hover:bg-btn-hover"
        >
          ×
        </button>
      </div>
      {elsewhere > 0 && (
        <p
          data-testid="elsewhere-need-you"
          className="self-start px-8 text-xs font-bold text-bg-dark"
          style={{ background: "var(--color-room-permission)" }}
        >
          {`${elsewhere} elsewhere need you`}
        </p>
      )}
      {overview.macs.map((mac) => (
        <section
          key={mac.machineId}
          data-testid={`drawer-mac-${mac.machineId}`}
          data-offline={String(!mac.online)}
          className="flex flex-col gap-6"
          style={{ opacity: mac.online ? 1 : 0.5 }}
        >
          <h3 className="text-xs text-text-muted">
            {`${mac.machineName} · ${mac.online ? "online" : "offline"}`}
          </h3>
          {mac.companies.length === 0 && mac.online && (
            <p className="text-xs text-text-muted">No companies yet</p>
          )}
          {mac.companies.map(({ company, counts, needsYou }) => (
            <div
              key={company.key}
              data-testid={`drawer-company-${company.name}`}
              className={`border-2 ${company.key === selectedKey ? "border-accent-bright bg-active-bg" : needsYou ? "border-warning" : "border-border bg-btn-bg"}`}
            >
              <button
                type="button"
                title={company.name}
                aria-current={company.key === selectedKey ? "page" : undefined}
                onClick={() => onSelect(company.key)}
                className="flex w-full flex-col gap-4 p-8 text-left hover:bg-btn-hover"
              >
                <span className="truncate font-bold">{company.name}</span>
                <CountRow counts={counts} />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
