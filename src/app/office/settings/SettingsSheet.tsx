import { DesktopSettings } from "./DesktopSettings";
import { PhoneSettings } from "./PhoneSettings";

interface SettingsSheetProps {
  /** Whether this is a real phone, which has its own settings. */
  phone: boolean;
  onClose: () => void;
}

/**
 * The device settings of this screen: the phone's sheet or the Mac's dialog.
 * @param props - The screen and what to do on close.
 * @returns The settings.
 */
export function SettingsSheet({ phone, onClose }: SettingsSheetProps) {
  return phone ? (
    <PhoneSettings onClose={onClose} />
  ) : (
    <DesktopSettings onClose={onClose} />
  );
}
