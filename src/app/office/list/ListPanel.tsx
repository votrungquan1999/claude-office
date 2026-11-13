import { useState } from "react";
import { CharacterMugShot } from "@/office/components/CharacterMugShot";
import type { SessionDto } from "@/shared/session";
import { sessionKey } from "@/shared/session";
import { ListRow } from "./ListRow";

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

interface ListPanelProps {
  /** The viewed company's shown name. */
  companyName: string;
  /** The company's live employees in the owner's order. */
  employees: SessionDto[];
  /** The conversations this device has opened or already had; null when it cannot remember, so no row is new. */
  seenKeys: ReadonlySet<string> | null;
  /** The employee whose card is open, if any. */
  selectedKey: string | null;
  /** The employee last picked in the office, with a number that changes on every pick; null when the list made the last pick. */
  reveal: { key: string; token: number } | null;
  /** Today's departures of the viewed company, newest first. */
  departures: DepartureRow[];
  /** Opens a departure's card. */
  onSelectDeparture: (key: string) => void;
  /** The Macs that are offline. */
  offlineMachineIds: ReadonlySet<string>;
  /** How each repo tag of the viewed company is written, by tag key. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's. */
  serverOffsetMs: number;
  onSelect: (key: string) => void;
  onMoveToIdle: (key: string) => void;
  onRename: (key: string, name: string) => Promise<boolean>;
}

/**
 * The list beside the office: the viewed company's employees in the owner's order.
 * @param props - The company, its employees and the handlers.
 * @returns The panel.
 */
export function ListPanel({
  companyName,
  employees,
  seenKeys,
  selectedKey,
  reveal,
  departures,
  onSelectDeparture,
  offlineMachineIds,
  tagLabels,
  serverOffsetMs,
  onSelect,
  onMoveToIdle,
  onRename,
}: ListPanelProps) {
  const [wentHomeOpen, setWentHomeOpen] = useState(false);
  return (
    <aside
      aria-label="Employees"
      data-testid="list-panel"
      className="flex min-h-0 w-[400px] max-w-[60%] shrink-0 flex-col border-l-2 border-border bg-bg-dark text-sm"
    >
      <div className="flex h-40 shrink-0 items-center border-b-2 border-border px-12">
        <span data-testid="list-title" className="text-xs text-text-muted">
          {companyName} · {employees.length}{" "}
          {employees.length === 1 ? "employee" : "employees"}
        </span>
      </div>
      <section aria-label="Everyone" className="flex min-h-0 flex-1 flex-col">
        <ul
          data-testid="list-everyone"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {employees.map((session) => (
            <ListRow
              key={sessionKey(session)}
              session={session}
              isNew={seenKeys !== null && !seenKeys.has(sessionKey(session))}
              selected={sessionKey(session) === selectedKey}
              revealToken={
                reveal?.key === sessionKey(session) ? reveal.token : null
              }
              offline={offlineMachineIds.has(session.machineId)}
              tagLabels={tagLabels}
              serverOffsetMs={serverOffsetMs}
              onSelect={onSelect}
              onMoveToIdle={onMoveToIdle}
              onRename={onRename}
            />
          ))}
        </ul>
      </section>
      <section
        aria-label="Went home today"
        className="shrink-0 border-t-2 border-border"
      >
        <button
          type="button"
          aria-expanded={wentHomeOpen}
          onClick={() => setWentHomeOpen(!wentHomeOpen)}
          className="flex h-46 w-full items-center gap-8 px-12 text-left text-sm"
        >
          <span aria-hidden="true" className="text-xs">
            {wentHomeOpen ? "▼" : "▶"}
          </span>
          <span className="font-bold">Went home today</span>
          <span className="bg-border px-6 text-xs">{departures.length}</span>
        </button>
        {wentHomeOpen && departures.length === 0 && (
          <p className="px-12 pb-10 text-text-muted">
            Nobody has gone home today
          </p>
        )}
        {wentHomeOpen && (
          <ul
            data-testid="went-home-list"
            className="max-h-[40vh] overflow-y-auto pb-6"
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
    </aside>
  );
}
