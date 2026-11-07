import type { SessionDto } from "@/shared/session";

interface WentHomeListProps {
  departures: SessionDto[];
  onSelect: (session: SessionDto) => void;
}

/**
 * The last path segment of a folder.
 * @param cwd - A folder path.
 * @returns Its name.
 */
function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/**
 * Today's departures: desk name, machine, folder and time, newest first.
 * @param props - The departures and the click handler.
 * @returns The list, or a line saying nobody has gone home.
 */
export function WentHomeList({ departures, onSelect }: WentHomeListProps) {
  return (
    <section
      data-testid="went-home-list"
      className="absolute bottom-2 left-2 z-10 max-h-48 max-w-xs overflow-y-auto border-2 border-border bg-bg p-2 text-sm"
    >
      <h2 className="font-bold">Went home today</h2>
      {departures.length === 0 ? (
        <p>Nobody has gone home today</p>
      ) : (
        <ul>
          {departures.map((session) => {
            const folder = folderName(session.cwd);
            const time = new Date(session.endedAt ?? "").toLocaleTimeString(
              "en-GB",
              { hour: "2-digit", minute: "2-digit" },
            );
            return (
              <li key={`${session.machineId}/${session.sessionId}`}>
                <button type="button" onClick={() => onSelect(session)}>
                  {`${session.deskName ?? folder} · ${session.machineName} / ${folder} · ${time}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
