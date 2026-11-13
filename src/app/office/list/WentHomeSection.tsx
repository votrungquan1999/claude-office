import { CharacterMugShot } from "@/office/components/CharacterMugShot";

/** One conversation that went home today. */
export interface DepartureRow {
  /** Session key, which opens its card. */
  key: string;
  palette: number;
  hueShift: number;
  /** The name shown for it. */
  task: string;
  /** `Mac / company/project`. */
  where: string;
  /** Local HH:MM it went home. */
  time: string;
}

interface WentHomeSectionProps {
  /** Whether the rows show. */
  open: boolean;
  onToggle: () => void;
  /** Today's departures of the viewed company, newest first. */
  departures: DepartureRow[];
  /** Opens a departure's card. */
  onSelectDeparture: (key: string) => void;
  /** Whether the list around it scrolls as one, so this section never scrolls on its own. */
  flat?: boolean;
}

/**
 * The folded section at the bottom of a list with the conversations that went home today.
 * @param props - The departures and the fold.
 * @returns The section.
 */
export function WentHomeSection({
  open,
  onToggle,
  departures,
  onSelectDeparture,
  flat = false,
}: WentHomeSectionProps) {
  return (
    <section
      aria-label="Went home today"
      className="shrink-0 border-t-2 border-border"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-46 w-full items-center gap-8 px-12 text-left text-sm"
      >
        <span aria-hidden="true" className="text-xs">
          {open ? "▼" : "▶"}
        </span>
        <span className="font-bold">Went home today</span>
        <span className="bg-border px-6 text-xs">{departures.length}</span>
      </button>
      {open && departures.length === 0 && (
        <p className="px-12 pb-10 text-text-muted">
          Nobody has gone home today
        </p>
      )}
      {open && (
        <ul
          data-testid="went-home-list"
          className={`pb-6 ${flat ? "" : "max-h-[40vh] overflow-y-auto"}`}
        >
          {departures.map((row) => (
            <li key={row.key} className="border-t border-bg-thumb">
              <button
                type="button"
                onClick={() => onSelectDeparture(row.key)}
                className="flex min-h-48 w-full items-center gap-10 px-12 py-4 text-left hover:bg-btn-hover"
              >
                <span aria-hidden="true" className="shrink-0 opacity-60">
                  <CharacterMugShot
                    palette={row.palette}
                    hueShift={row.hueShift}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="truncate text-base">{row.task}</span>
                  <span className="truncate text-xs text-text-muted">
                    {row.where}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  left {row.time}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
