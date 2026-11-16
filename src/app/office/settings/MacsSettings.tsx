import type { MachineDto } from "@/shared/session";

interface MacsSettingsProps {
  /** Every Mac the office has a record of. */
  machines: MachineDto[];
}

const STARTED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The facts line of one Mac's agent; parts an older agent does not report are left out.
 * @param machine - The Mac.
 * @returns "Agent 0.5.0 · Code abc1234 · Started 16 Nov, 09:30".
 */
function agentLine(machine: MachineDto): string {
  return [
    machine.agentVersion
      ? `Agent ${machine.agentVersion}`
      : "Agent version unknown",
    machine.agentCommit && `Code ${machine.agentCommit}`,
    machine.agentStartedAt &&
      `Started ${STARTED_FORMAT.format(new Date(machine.agentStartedAt))}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The Macs group of the settings: each Mac's agent and whether it needs a restart.
 * @param props - The Macs.
 * @returns The group.
 */
export function MacsSettings({ machines }: MacsSettingsProps) {
  const sorted = machines.toSorted((a, b) =>
    a.machineName.localeCompare(b.machineName),
  );
  return (
    <section aria-label="Macs" className="flex flex-col gap-6">
      <h3 className="font-bold">Macs</h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-text-muted">No Mac has connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {sorted.map((machine) => (
            <li
              key={machine.machineId}
              className="flex flex-col gap-2 border-2 border-border bg-btn-bg px-10 py-6"
            >
              <div className="flex items-center justify-between gap-8">
                <span className="truncate font-bold">
                  {machine.machineName}
                </span>
                {machine.restartNeeded && (
                  <span className="shrink-0 text-xs font-bold text-warning">
                    Restart needed
                  </span>
                )}
              </div>
              <span className="text-xs text-text-muted">
                {agentLine(machine)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
