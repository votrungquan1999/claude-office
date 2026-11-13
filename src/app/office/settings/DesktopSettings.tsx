import { ToggleSwitch } from "../ToggleSwitch";
import { useEscape } from "../useEscape";
import { storeDeviceSettings, useDeviceSettings } from "./deviceSettings";

interface DesktopSettingsProps {
  onClose: () => void;
}

/**
 * The Mac's settings dialog: how the list starts, what the tab says and what Needs you lists.
 * @param props - What to do on close.
 * @returns A scrim and the dialog under the Settings button.
 */
export function DesktopSettings({ onClose }: DesktopSettingsProps) {
  const settings = useDeviceSettings();
  useEscape(onClose);
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="settings-scrim"
        onClick={onClose}
        className="fixed inset-0 z-[68] bg-bg-dark/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed top-[60px] right-8 z-[70] flex w-[420px] max-w-[calc(100%-16px)] flex-col gap-12 border-2 border-border bg-bg p-12 text-sm"
      >
        <div className="flex items-center justify-between gap-8">
          <h2 className="text-lg font-bold">Settings</h2>
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
        <section
          aria-label="List when the office opens"
          className="flex flex-col gap-6"
        >
          <h3 className="font-bold">List when the office opens</h3>
          <p className="text-xs text-text-muted">
            Start with the list open beside the office, or folded to the thin
            strip on the right.
          </p>
          <div className="flex gap-8">
            {(["open", "folded"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={settings.listStart === choice}
                onClick={() => storeDeviceSettings({ listStart: choice })}
                className={`min-h-[44px] flex-1 border-2 px-12 ${settings.listStart === choice ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg"}`}
              >
                {choice === "open" ? "Open" : "Folded"}
              </button>
            ))}
          </div>
        </section>
        <div className="flex items-center gap-12">
          <div className="flex-1">
            <h3 className="font-bold">Count in the browser tab</h3>
            <p className="text-xs text-text-muted">
              The tab title reads "(8) Claude Office" while 8 employees need
              you, so you see it from other tabs.
            </p>
          </div>
          <ToggleSwitch
            size="large"
            label="Count in the browser tab"
            checked={settings.tabCount}
            onToggle={() =>
              storeDeviceSettings({ tabCount: !settings.tabCount })
            }
          />
        </div>
        <div className="flex items-center gap-12">
          <div className="flex-1">
            <h3 className="font-bold">Needs you includes other companies</h3>
            <p className="text-xs text-text-muted">
              Employees from your other companies who need you show in Needs
              you, under "In other companies". On by default.
            </p>
          </div>
          <ToggleSwitch
            size="large"
            label="Needs you includes other companies"
            checked={settings.needsYouOtherCompanies}
            onToggle={() =>
              storeDeviceSettings({
                needsYouOtherCompanies: !settings.needsYouOtherCompanies,
              })
            }
          />
        </div>
      </div>
    </>
  );
}
