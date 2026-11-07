import { remoteControlUrl } from "@/office/remoteControl";
import { type SessionDto, sessionKey } from "@/shared/session";
import { StepsList } from "./StepsList";

interface DetailsPanelProps {
  session: SessionDto | null;
  onClose: () => void;
}

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/**
 * The details of the selected employee, with its Remote Control link.
 * @param props - The selected session and the close handler.
 * @returns The panel, or nothing when no employee is selected.
 */
export function DetailsPanel({ session, onClose }: DetailsPanelProps) {
  if (!session) return null;
  // An ended session has nothing left to control, so it gets no link and no "off" message.
  const ended = session.state === "wentHome";
  const remoteControl = remoteControlUrl(session.bridgeSessionId);
  return (
    <aside
      data-testid="details-panel"
      className="absolute top-2 left-2 z-20 max-h-[calc(100%-1rem)] max-w-xs overflow-y-auto border-2 border-border bg-bg p-2 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold">
          {session.deskName ?? folderName(session.cwd)}
        </h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p>{session.machineName}</p>
      <p className="break-all">{session.cwd}</p>
      {session.currentTodo && (
        <p data-testid="current-todo">{session.currentTodo}</p>
      )}
      <StepsList key={sessionKey(session)} session={session} />
      {ended ? null : remoteControl ? (
        <a
          data-testid="remote-control-link"
          href={remoteControl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Open Remote Control
        </a>
      ) : (
        <p>Remote Control is off for this session</p>
      )}
    </aside>
  );
}
