import { CharacterMugShot } from "@/office/components/CharacterMugShot";
import { useEscape } from "./useEscape";

export interface WentHomeRow {
  /** Session key, which opens its details. */
  key: string;
  palette: number;
  hueShift: number;
  /** The task name in full. */
  task: string;
  /** `Mac / company/project`. */
  where: string;
  /** Local HH:MM it went home. */
  time: string;
}

export interface WentHomeDrawerProps {
  /** The viewed company's shown name. */
  companyName: string;
  /** Today's departures of that company, newest first. */
  rows: WentHomeRow[];
  /** A details card was opened after this drawer, so Escape closes that card first. */
  detailsOpen: boolean;
  onSelect: (key: string) => void;
  onCloseDetails: () => void;
  onClose: () => void;
}

/**
 * Today's departures of the viewed company, as the phone's bottom sheet over the office.
 * @param props - The company, its rows and the handlers.
 * @returns The went-home dialog.
 */
export function WentHomeDrawer({
  companyName,
  rows,
  detailsOpen,
  onSelect,
  onCloseDetails,
  onClose,
}: WentHomeDrawerProps) {
  // A card opened over the drawer closes first.
  useEscape(detailsOpen ? onCloseDetails : onClose);
  return (
    <section
      role="dialog"
      aria-label="Went home today"
      data-testid="went-home-drawer"
      className="absolute inset-x-0 bottom-0 z-[70] flex max-h-[85%] flex-col border-t-2 border-border bg-bg text-sm"
    >
      <div className="flex shrink-0 items-center justify-between gap-8 border-b-2 border-border px-12 py-10">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-lg font-bold">Went home today</h2>
          <span className="truncate text-xs text-text-muted">
            {`${companyName} · newest first`}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close"
          // biome-ignore lint/a11y/noAutofocus: a dialog moves focus into itself
          autoFocus
          onClick={onClose}
          className="h-36 w-36 shrink-0 border-2 border-border bg-btn-bg text-base hover:bg-btn-hover"
        >
          ×
        </button>
      </div>
      {rows.length === 0 && (
        <p className="px-12 py-10 text-text-muted">
          Nobody has gone home today
        </p>
      )}
      <ul
        data-testid="went-home-list"
        className="min-h-0 flex-1 overflow-y-auto py-6"
      >
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onSelect(row.key)}
              className="flex w-full items-start gap-12 border-b-2 border-bg-dark px-12 py-10 text-left hover:bg-btn-hover"
            >
              <span aria-hidden="true" className="shrink-0 pt-2">
                <CharacterMugShot
                  palette={row.palette}
                  hueShift={row.hueShift}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-4">
                <span className="break-words">{row.task}</span>
                <span className="break-words text-xs text-text-muted">
                  {row.where}
                </span>
              </span>
              <span className="shrink-0 pt-2 text-xs text-text-muted">
                {row.time}
              </span>
              <span
                aria-hidden="true"
                className="shrink-0 pt-2 text-text-muted"
              >
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
