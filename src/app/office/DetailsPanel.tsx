import { remoteControlUrl } from "@/office/remoteControl";
import { ROOM_DISPLAY_NAMES, ROOM_OF_STATE } from "@/office/rooms";
import { type SessionDto, sessionKey } from "@/shared/session";
import { StepsList } from "./StepsList";

interface DetailsPanelProps {
  session: SessionDto | null;
  offlineMachineIds: ReadonlySet<string>;
  /** Phones get a bottom sheet instead of a side panel. */
  sheet: boolean;
  onClose: () => void;
}

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

const PILL_COLORS: Record<string, string> = {
  working: "bg-room-working",
  thinking: "bg-room-working",
  needsPermission: "bg-room-permission",
  waitingForYou: "bg-room-waiting-for-you",
  idle: "bg-room-idle",
  wentHome: "bg-pill-offline",
  offline: "bg-pill-offline",
};

/**
 * What the state pill says and which colour key it takes.
 * @param session - The session shown.
 * @param offline - Whether the session's Mac is offline.
 * @returns The pill's text and its state key.
 */
function pillOf(
  session: SessionDto,
  offline: boolean,
): { text: string; key: string } {
  if (session.state === "wentHome")
    return { text: "Went home", key: "wentHome" };
  if (offline) return { text: "Mac offline", key: "offline" };
  // Thinking shares the Working room but keeps its own wording.
  if (session.state === "thinking")
    return { text: "Thinking", key: "thinking" };
  const room = ROOM_OF_STATE[session.state];
  return {
    text: room ? ROOM_DISPLAY_NAMES[room] : "",
    key: session.state,
  };
}

const MAX_PATH_LENGTH = 28;

/**
 * A folder in short form.
 * @param cwd - The folder path.
 * @returns The path as it is shown.
 */
export function shortenPath(cwd: string): string {
  // The browser cannot read $HOME, so the owner's home is taken as the first two segments of /Users/<name> or /home/<name>.
  const home = /^\/(?:Users|home)\/[^/]+/.exec(cwd);
  const path = home ? `~${cwd.slice(home[0].length)}` : cwd;
  const segments = path.split("/");
  if (path.length <= MAX_PATH_LENGTH || segments.length <= 3) return path;
  return `${segments[0] || "/"}/…/${segments.at(-1)}`.replace("//", "/");
}

/**
 * The details of the selected employee, with its Remote Control link.
 * @param props - The selected session, whether to lay out as a sheet, and the close handler.
 * @returns The panel, or nothing when no employee is selected.
 */
export function DetailsPanel({
  session,
  offlineMachineIds,
  sheet,
  onClose,
}: DetailsPanelProps) {
  if (!session) return null;
  // An ended session has nothing left to control, so it gets no link and no "off" message.
  const ended = session.state === "wentHome";
  const pill = pillOf(session, offlineMachineIds.has(session.machineId));
  const remoteControl = remoteControlUrl(session.bridgeSessionId);
  return (
    <aside
      data-testid="details-panel"
      className={`absolute z-[60] flex flex-col gap-2 border-2 border-border bg-bg p-3 text-sm ${
        sheet
          ? "inset-x-0 bottom-0 max-h-[70%] border-x-0 border-b-0"
          : "top-2 left-2 max-h-[calc(100%-1rem)] w-[360px] max-w-[calc(100%-1rem)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="line-clamp-2 min-w-0 text-lg leading-[1.15] font-bold break-words">
          {session.deskName ?? folderName(session.cwd)}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 px-2 text-lg leading-none hover:bg-btn-hover"
        >
          ×
        </button>
      </div>
      <span
        data-testid="state-pill"
        data-state={pill.key}
        className={`self-start px-2 text-xs text-bg-dark ${PILL_COLORS[pill.key]}`}
      >
        {pill.text}
      </span>
      <p className="truncate text-xs text-text-muted">
        {session.machineName}
        {" · "}
        <span data-testid="folder" title={session.cwd}>
          {shortenPath(session.cwd)}
        </span>
      </p>
      {session.currentTodo && (
        <p data-testid="current-todo" className="text-xs">
          {session.currentTodo}
        </p>
      )}
      {ended ? null : remoteControl ? (
        <a
          data-testid="remote-control-link"
          href={remoteControl}
          target="_blank"
          rel="noopener noreferrer"
          className="border-2 border-accent-bright bg-accent px-3 py-1 text-center font-bold hover:bg-accent-bright"
        >
          Open in Remote Control ↗
        </a>
      ) : (
        <p className="text-xs text-text-muted">Remote Control off</p>
      )}
      <hr className="border-border" />
      <StepsList key={sessionKey(session)} session={session} />
    </aside>
  );
}
