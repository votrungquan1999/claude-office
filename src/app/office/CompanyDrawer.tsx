import { useEffect } from "react";
import type { Overview } from "@/shared/overview";
import { CountRow } from "./CompanyStrip";

export interface CompanyDrawerProps {
  overview: Overview;
  /** The viewed company. */
  selectedKey: string | null;
  /** Full-width sheet on a phone; a side panel elsewhere. */
  sheet: boolean;
  /** The sheet covers the whole canvas height, for a sideways phone. */
  fullHeight?: boolean;
  /** Why the last switch did not stick, shown until the next one. */
  error?: string | null;
  onSelect: (companyKey: string) => void;
  /** Asks to switch company mode on or off for one folder of one Mac. */
  onSetCompanyMode: (
    machineId: string,
    path: string,
    companyMode: boolean,
  ) => void;
  onClose: () => void;
}

interface CompanySwitchProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

/**
 * The company-mode switch of one folder.
 * @param props - Its accessible name, its position and what to do on a press.
 * @returns A switch button with a 44 px tap target.
 */
function CompanySwitch({ label, checked, onToggle }: CompanySwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center hover:bg-btn-hover"
    >
      <span
        aria-hidden="true"
        className={`flex h-[18px] w-[34px] items-center border-2 border-border px-2 ${checked ? "justify-end bg-accent-bright" : "justify-start bg-bg-dark"}`}
      >
        <span className="block h-[10px] w-[10px] bg-text" />
      </span>
    </button>
  );
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
  fullHeight = false,
  error = null,
  onSelect,
  onSetCompanyMode,
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
          ? fullHeight
            ? "inset-0 border-0"
            : "inset-x-0 bottom-0 max-h-[85%] border-x-0 border-b-0"
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
      {error && (
        <p role="alert" className="px-8 text-xs font-bold text-warning">
          {error}
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
          {mac.companies.map(({ company, counts, needsYou }) => {
            const { path } = company;
            return (
              <div
                key={company.key}
                data-testid={`drawer-company-${company.name}`}
                className={`border-2 ${company.key === selectedKey ? "border-accent-bright bg-active-bg" : needsYou ? "border-warning" : "border-border bg-btn-bg"}`}
              >
                <div className="flex items-stretch">
                  <button
                    type="button"
                    title={company.name}
                    aria-current={
                      company.key === selectedKey ? "page" : undefined
                    }
                    onClick={() => onSelect(company.key)}
                    className="flex min-w-0 flex-1 flex-col gap-4 p-8 text-left hover:bg-btn-hover"
                  >
                    <span className="truncate font-bold">{company.name}</span>
                    <CountRow counts={counts} />
                  </button>
                  {path !== null && (
                    <CompanySwitch
                      label={`Company mode for ${company.name}`}
                      checked
                      onToggle={() =>
                        onSetCompanyMode(company.machineId, path, false)
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
          {mac.switchedOff.map((folder) => (
            <div
              key={folder.path}
              data-testid={`drawer-off-${folder.name}`}
              data-dimmed="true"
              className="flex items-center border-2 border-border bg-btn-bg"
              style={{ opacity: 0.6 }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-4 p-8">
                <span className="truncate font-bold">{folder.name}</span>
                <span className="text-xs text-text-muted">in Other</span>
              </div>
              <CompanySwitch
                label={`Company mode for ${folder.name}`}
                checked={false}
                onToggle={() =>
                  onSetCompanyMode(mac.machineId, folder.path, true)
                }
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
