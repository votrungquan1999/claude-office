import { AgentRestartBlock, agentRestartBlock } from "@/office/offline";
import type { MachineDto } from "@/shared/session";
import {
  type AgentRestarts,
  type AgentRestartView,
  RestartPhase,
} from "./useAgentRestarts";

interface MacsSettingsProps {
  /** Every Mac the office has a record of. */
  machines: MachineDto[];
  /** The server's time, which judges whether a Mac is online. */
  serverNow: string;
  /** The restarts asked for from this page. */
  restarts: AgentRestarts;
}

const STARTED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Why the Restart agent button of a Mac is off, in the owner's words. */
const BLOCK_LINES: Record<AgentRestartBlock, string> = {
  [AgentRestartBlock.Offline]: "That Mac is offline.",
  [AgentRestartBlock.Outdated]:
    "This agent is older than 0.5.0; restart it on the Mac once.",
  [AgentRestartBlock.StartedByHand]:
    "Started by hand on the Mac; restart it there.",
};

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
 * The line under a Mac's Restart agent button: how its restart stands, else why the button is off.
 * @param view - The restart asked for from this page, if any.
 * @param block - Why the Mac cannot be restarted from here, if it cannot.
 * @returns The line, or undefined when there is nothing to say.
 */
function restartLine(
  view: AgentRestartView | undefined,
  block: AgentRestartBlock | undefined,
): string | undefined {
  if (view?.phase === RestartPhase.Restarting) return "Restarting…";
  if (view?.phase === RestartPhase.NotBack) {
    return "The agent has not come back after a minute. Check the Mac.";
  }
  if (view?.phase === RestartPhase.Refused) {
    return `Not restarted: ${view.error}`;
  }
  return block ? BLOCK_LINES[block] : undefined;
}

/**
 * The Macs group of the settings: each Mac's agent and the button that restarts it.
 * @param props - The Macs, the server's time and the restarts.
 * @returns The group.
 */
export function MacsSettings({
  machines,
  serverNow,
  restarts,
}: MacsSettingsProps) {
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
          {sorted.map((machine) => {
            const view = restarts.viewOf(machine);
            const block = agentRestartBlock(machine, serverNow);
            const line = restartLine(view, block);
            return (
              <li
                key={machine.machineId}
                className="flex flex-col gap-4 border-2 border-border bg-btn-bg px-10 py-6"
              >
                <span className="truncate font-bold">
                  {machine.machineName}
                </span>
                <span className="text-xs text-text-muted">
                  {agentLine(machine)}
                </span>
                <button
                  type="button"
                  disabled={
                    block !== undefined ||
                    view?.phase === RestartPhase.Restarting
                  }
                  onClick={() => void restarts.restart(machine)}
                  className="min-h-[44px] self-start border-2 border-border bg-bg px-12 hover:bg-btn-hover disabled:opacity-50"
                >
                  Restart agent
                </button>
                {line && (
                  <p role="status" className="text-xs text-text-muted">
                    {line}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
