import { useEffect, useRef, useState } from "react";

/**
 * Whether the device settings are open, and the Settings button that opens them.
 * @param layoutKey - Changes when the screen switches between the phone and the other layouts, which closes the settings.
 * @param beforeOpen - Closes whatever sheet is open, so two never stack.
 * @returns The open state, the close handler and the props the company strip's Settings button takes.
 */
export function useSettingsPanel(layoutKey: boolean, beforeOpen: () => void) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The settings of one layout do not belong on another.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes when the layout flips
  useEffect(() => setOpen(false), [layoutKey]);
  return {
    open,
    /** Closes the settings and hands focus back to the button. */
    close: () => {
      setOpen(false);
      buttonRef.current?.focus();
    },
    stripProps: {
      onOpenSettings: () => {
        beforeOpen();
        setOpen(true);
      },
      settingsButtonRef: buttonRef,
      settingsOpen: open,
    },
  };
}
