import { useEffect, useRef, useState } from "react";

interface SettingsPanelInput {
  /** Whether this layout has settings; the button shows only then. */
  enabled: boolean;
  /** Closes whatever sheet is open, so two never stack. */
  beforeOpen: () => void;
}

/**
 * Whether the device settings are open, and the Settings button that opens them.
 * @param input - Whether this layout has settings, and what to close first.
 * @returns The open state, the close handler and the props the company strip's Settings button takes.
 */
export function useSettingsPanel({ enabled, beforeOpen }: SettingsPanelInput) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The settings of one layout do not belong on another.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  return {
    open,
    /** Closes the settings and hands focus back to the button. */
    close: () => {
      setOpen(false);
      buttonRef.current?.focus();
    },
    stripProps: {
      onOpenSettings: enabled
        ? () => {
            beforeOpen();
            setOpen(true);
          }
        : undefined,
      settingsButtonRef: buttonRef,
      settingsOpen: open,
    },
  };
}
