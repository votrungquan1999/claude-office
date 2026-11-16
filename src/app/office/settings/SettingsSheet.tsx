import type { MachineDto } from "@/shared/session";
import { DesktopSettings } from "./DesktopSettings";
import { PhoneSettings } from "./PhoneSettings";

interface SettingsSheetProps {
  /** Whether this is a real phone, which has its own settings. */
  phone: boolean;
  /** Every Mac, for the Macs group. */
  machines: MachineDto[];
  onClose: () => void;
}

/**
 * The device settings of this screen: the phone's sheet or the Mac's dialog.
 * @param props - The screen, the Macs and what to do on close.
 * @returns The settings.
 */
export function SettingsSheet({
  phone,
  machines,
  onClose,
}: SettingsSheetProps) {
  return phone ? (
    <PhoneSettings machines={machines} onClose={onClose} />
  ) : (
    <DesktopSettings machines={machines} onClose={onClose} />
  );
}
