import type { MachineDto } from "@/shared/session";
import { DesktopSettings } from "./DesktopSettings";
import { PhoneSettings } from "./PhoneSettings";
import type { AgentRestarts } from "./useAgentRestarts";

interface SettingsSheetProps {
  /** Whether this is a real phone, which has its own settings. */
  phone: boolean;
  /** Every Mac, for the Macs group. */
  machines: MachineDto[];
  /** The server's time, which judges whether a Mac is online. */
  serverNow: string;
  /** The restarts asked for from this page. */
  restarts: AgentRestarts;
  onClose: () => void;
}

/**
 * The device settings of this screen: the phone's sheet or the Mac's dialog.
 * @param props - The screen, the Macs with their restarts and what to do on close.
 * @returns The settings.
 */
export function SettingsSheet({
  phone,
  machines,
  serverNow,
  restarts,
  onClose,
}: SettingsSheetProps) {
  const macs = { machines, serverNow, restarts };
  return phone ? (
    <PhoneSettings {...macs} onClose={onClose} />
  ) : (
    <DesktopSettings {...macs} onClose={onClose} />
  );
}
