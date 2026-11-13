interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** The drawer's small track, or the settings dialog's larger one. */
  size?: "small" | "large";
}

/**
 * An on/off switch with a 44 px tap target.
 * @param props - Its accessible name, its position and what to do on a press.
 * @returns A switch button.
 */
export function ToggleSwitch({
  label,
  checked,
  onToggle,
  size = "small",
}: ToggleSwitchProps) {
  const large = size === "large";
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
        className={`flex items-center border-2 border-border px-2 ${large ? "h-[30px] w-[56px]" : "h-[18px] w-[34px]"} ${checked ? "justify-end bg-accent-bright" : "justify-start bg-bg-dark"}`}
      >
        <span
          className={`block bg-text ${large ? "h-[18px] w-[18px]" : "h-[10px] w-[10px]"}`}
        />
      </span>
    </button>
  );
}
