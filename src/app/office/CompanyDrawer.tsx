import { type ReactNode, useEffect, useRef, useState } from "react";
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
  /** Asks to name a company, or with null to put its folder name back. */
  onRename?: (machineId: string, path: string, name: string | null) => void;
  onClose: () => void;
  /** Extra controls under the title, such as the tag filter on a sideways phone. */
  extra?: ReactNode;
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
  onRename,
  onClose,
  extra,
}: CompanyDrawerProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Pencils by company, so closing an editor can hand focus back.
  const pencils = useRef(new Map<string, HTMLButtonElement>());
  const closeEditor = (companyKey: string) => {
    setEditingKey(null);
    pencils.current.get(companyKey)?.focus();
  };
  // A company that disappears while it is being named takes its editor with it.
  const editingGone =
    editingKey !== null &&
    !overview.macs.some((mac) =>
      mac.companies.some((entry) => entry.company.key === editingKey),
    );
  useEffect(() => {
    if (editingGone) setEditingKey(null);
  }, [editingGone]);
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
      {extra && <div className="no-scrollbar overflow-x-auto">{extra}</div>}
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
                    <span className="break-words font-bold">
                      {company.name}
                    </span>
                    <CountRow counts={counts} />
                  </button>
                  {path !== null && (
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) pencils.current.set(company.key, element);
                        else pencils.current.delete(company.key);
                      }}
                      aria-label={`Rename ${company.name}`}
                      onClick={() => {
                        setEditingKey(company.key);
                        setDraft(company.name);
                      }}
                      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center hover:bg-btn-hover"
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M2 12l1-3 7-7 2 2-7 7z" />
                      </svg>
                    </button>
                  )}
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
                {path !== null && editingKey === company.key && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      closeEditor(company.key);
                      const name = draft.trim();
                      // An unchanged name sends nothing; a blank one puts the folder name back.
                      if (name !== company.name) {
                        onRename?.(company.machineId, path, name || null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      // Escape anywhere in the editor cancels the edit; the drawer stays open.
                      event.stopPropagation();
                      event.nativeEvent.stopImmediatePropagation();
                      closeEditor(company.key);
                    }}
                    className="flex flex-col gap-6 border-t-2 border-border p-8"
                  >
                    <label className="flex flex-col gap-4 text-xs text-text-muted">
                      {`Name for folder ${company.folderName}`}
                      <input
                        // biome-ignore lint/a11y/noAutofocus: the editor opens from the owner's press on its pencil
                        autoFocus
                        maxLength={100}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        className="border-2 border-border bg-bg-dark px-8 py-6 text-sm text-text"
                      />
                    </label>
                    <div className="flex gap-8">
                      <button
                        type="submit"
                        className="min-h-[44px] flex-1 border-2 border-border bg-btn-bg px-10 hover:bg-btn-hover"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => closeEditor(company.key)}
                        className="min-h-[44px] flex-1 border-2 border-border bg-btn-bg px-10 hover:bg-btn-hover"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
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
