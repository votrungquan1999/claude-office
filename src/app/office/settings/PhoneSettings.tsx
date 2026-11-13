import { useEscape } from "../useEscape";
import {
  type DeviceSettings,
  storeDeviceSettings,
  useDeviceSettings,
} from "./deviceSettings";

interface PhoneSettingsProps {
  onClose: () => void;
}

const VIEWS: Array<{
  view: DeviceSettings["phoneView"];
  label: string;
  sentence: string;
}> = [
  {
    view: "list",
    label: "List",
    sentence:
      "One list in your order, with Needs you on top. The same order as on the Mac.",
  },
  {
    view: "rooms",
    label: "Rooms",
    sentence: "Employees grouped into rooms by what they are doing.",
  },
];

/**
 * The phone's settings sheet: whether it shows the list or the stacked rooms.
 * @param props - What to do on close.
 * @returns A scrim over the screen and the bottom sheet.
 */
export function PhoneSettings({ onClose }: PhoneSettingsProps) {
  const { phoneView: view } = useDeviceSettings();
  useEscape(onClose);
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="settings-scrim"
        onClick={onClose}
        className="fixed inset-0 z-[68] bg-[rgba(8,8,16,0.62)]"
      />
      <div
        role="dialog"
        aria-label="Settings"
        className="absolute inset-x-0 bottom-0 z-[70] flex max-h-[85%] flex-col gap-8 overflow-y-auto border-2 border-b-0 border-x-0 border-border bg-bg p-12 text-sm"
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
        <fieldset aria-label="Phone view" className="flex flex-col gap-8">
          <span className="font-bold">Phone view</span>
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              onClick={() => storeDeviceSettings({ phoneView: option.view })}
              className={`flex min-h-[56px] flex-col items-start justify-center border-2 px-12 text-left ${view === option.view ? "border-accent-bright bg-active-bg" : "border-border bg-btn-bg"}`}
            >
              <span className="font-bold">{option.label}</span>
              <span className="text-xs text-text-muted">{option.sentence}</span>
            </button>
          ))}
        </fieldset>
        <p className="text-xs text-text-muted">
          Changes this phone only; the Mac keeps the office and the list.
        </p>
      </div>
    </>
  );
}
