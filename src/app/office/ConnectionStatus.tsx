interface ConnectionStatusProps {
  /** When the last answer arrived; null before the first. */
  lastUpdatedAt: number | null;
  connectionLost: boolean;
  now: number;
}

/**
 * Says how fresh the office is, and warns when it has stopped updating.
 * @param props - The last update time, whether polling is failing, and the current time.
 * @returns The status line and, when the connection is lost, a warning banner.
 */
export function ConnectionStatus({
  lastUpdatedAt,
  connectionLost,
  now,
}: ConnectionStatusProps) {
  const minutes =
    lastUpdatedAt === null
      ? null
      : Math.max(0, Math.floor((now - lastUpdatedAt) / 60_000));
  return (
    <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-1 text-xs">
      {connectionLost && (
        <p role="alert" className="border-2 border-border bg-bg p-1 font-bold">
          Connection lost. Showing the last known office.
        </p>
      )}
      {minutes !== null && (
        <p data-testid="last-updated">
          {minutes === 0 ? "Updated just now" : `Updated ${minutes} min ago`}
        </p>
      )}
    </div>
  );
}
