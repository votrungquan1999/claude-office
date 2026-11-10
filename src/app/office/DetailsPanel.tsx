import { remoteControlUrl } from "@/office/remoteControl";
import { ROOM_DISPLAY_NAMES, ROOM_OF_STATE } from "@/office/rooms";
import { type SessionDto, sessionKey } from "@/shared/session";
import { formatElapsed } from "./elapsed";
import { StepsList } from "./StepsList";
import { useNow } from "./useNow";

interface DetailsPanelProps {
  session: SessionDto | null;
  /** The project the session started in below its company folder, when it has one. */
  project?: string;
  /** How each repo tag of the viewed company is written, by tag key: the same labels the chips and the employee labels use. */
  tagLabels: ReadonlyMap<string, string>;
  /** How far the server's clock is ahead of this browser's, so times count from the server's clock. */
  serverOffsetMs?: number;
  offlineMachineIds: ReadonlySet<string>;
  /** Phones get a bottom sheet instead of a side panel. */
  sheet: boolean;
  onClose: () => void;
}

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/** The look of a state band: its colour and the text colour that reads on it. */
interface BandStyle {
  background: string;
  text: string;
}

const BAND_STYLES = {
  working: { background: "bg-room-working", text: "text-bg-dark" },
  thinking: { background: "bg-room-working", text: "text-bg-dark" },
  needsPermission: { background: "bg-room-permission", text: "text-bg-dark" },
  waitingForYou: {
    background: "bg-room-waiting-for-you",
    text: "text-bg-dark",
  },
  idle: { background: "bg-room-idle", text: "text-bg-dark" },
  wentHome: { background: "bg-pill-offline", text: "text-text" },
  offline: { background: "bg-pill-offline", text: "text-text" },
  notRunning: { background: "bg-pill-offline", text: "text-text" },
} satisfies Record<string, BandStyle>;

/** Tags shown on the card before the rest fold into "+N". */
const MAX_TAGS = 3;

/**
 * What the state band says and which colour key it takes.
 * @param session - The session shown.
 * @param offline - Whether the session's Mac is offline.
 * @returns The band's text and its state key.
 */
function bandOf(
  session: SessionDto,
  offline: boolean,
): { text: string; key: keyof typeof BAND_STYLES } {
  if (session.state === "wentHome")
    return { text: "Went home", key: "wentHome" };
  // Still true when the Mac is offline: the window closed before that.
  if (session.notRunning) return { text: "Not running", key: "notRunning" };
  if (offline) return { text: "Mac offline", key: "offline" };
  // Thinking shares the Working room but keeps its own wording.
  if (session.state === "thinking")
    return { text: "Thinking", key: "thinking" };
  // The band is short, so the permission room reads "Needs you" here.
  if (session.state === "needsPermission")
    return { text: "Needs you", key: "needsPermission" };
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
 * The box under the title: what the session is doing now, or what it wants to run.
 * @param session - The session shown.
 * @param nowMs - The current time on the server's clock.
 * @returns The box, or nothing when the state has none.
 */
function boxOf(session: SessionDto, nowMs: number) {
  const running = session.runningSteps ?? [];
  if (session.state === "needsPermission") {
    // With several steps running nothing says which one asks, so no text is shown.
    const asking = running.length === 1 ? running[0] : undefined;
    return (
      <div
        data-testid="wants-to-run"
        className="flex shrink-0 flex-col gap-1 border-2 border-border bg-bg-dark px-3 py-2 [@media(max-height:500px)]:py-1"
      >
        <span className="text-xs text-room-permission uppercase">
          Wants to run
        </span>
        {asking && (
          <span
            data-testid="wants-to-run-text"
            className="truncate text-base text-approve"
          >
            {asking.text}
          </span>
        )}
      </div>
    );
  }
  let text: string | null = null;
  let since: string | undefined;
  if (session.state === "working") {
    const first = running[0];
    text = first ? first.text : "working…";
    since = first?.startedAt;
  } else if (session.state === "thinking") text = "thinking…";
  else if (session.state === "waitingForYou") text = "waiting for your reply";
  else if (session.state === "idle")
    text = session.recentSteps?.at(-1)?.text ?? null;
  if (text === null) return null;
  return (
    <div
      data-testid="terminal-box"
      className="flex shrink-0 items-baseline justify-between gap-2 border-2 border-border bg-bg-dark px-3 py-2 text-base [@media(max-height:500px)]:py-1"
    >
      <span
        data-testid="terminal-text"
        className="min-w-0 truncate text-accent-bright"
      >
        {`> ${text}`}
      </span>
      {since && (
        <span
          data-testid="terminal-time"
          className="shrink-0 text-text-muted tabular-nums"
        >
          {formatElapsed(nowMs - Date.parse(since))}
        </span>
      )}
    </div>
  );
}

/**
 * The details of the selected employee, with its Remote Control link.
 * @param props - The selected session, its project, the server clock offset, offline Macs, sheet layout and the close handler.
 * @returns The panel, or nothing when no employee is selected.
 */
export function DetailsPanel({ session, ...rest }: DetailsPanelProps) {
  return session ? <Card session={session} {...rest} /> : null;
}

/**
 * The card of one selected employee; it owns the once-a-second clock so the clock stops when the panel closes.
 * @param props - The panel's props with a session.
 * @returns The card.
 */
function Card({
  session,
  project,
  tagLabels,
  serverOffsetMs = 0,
  offlineMachineIds,
  sheet,
  onClose,
}: DetailsPanelProps & { session: SessionDto }) {
  // The browser's clock moved onto the server's, so a phone clock minutes off still shows right times.
  const nowMs = useNow() + serverOffsetMs;
  // A session with no process has nothing left to control, so it gets no link and no "off" message.
  const ended = session.state === "wentHome" || session.notRunning === true;
  const offline = offlineMachineIds.has(session.machineId);
  const approving = session.state === "needsPermission" && !offline;
  const band = bandOf(session, offline);
  const style = BAND_STYLES[band.key];
  const remoteControl = remoteControlUrl(session.bridgeSessionId);
  // A Mac that is offline says nothing about how long the session has been in its state; rows from before the stamp have none.
  const inState =
    (offline && !session.notRunning) || !session.stateSince
      ? null
      : formatElapsed(nowMs - Date.parse(session.stateSince));
  const box = offline || session.notRunning ? null : boxOf(session, nowMs);
  const tags = session.tags ?? [];
  return (
    <aside
      data-testid="details-panel"
      className={`absolute z-[60] flex flex-col border-2 border-border bg-bg text-sm [@media(max-height:500px)]:overflow-y-auto ${
        sheet
          ? "inset-x-0 bottom-0 max-h-[80%] border-x-0 border-b-0"
          : "top-2 left-2 max-h-[calc(100%-1rem)] w-[360px] max-w-[calc(100%-1rem)] shadow-[6px_6px_0_var(--color-bg-dark)]"
      }`}
    >
      <div
        data-testid="state-band"
        data-state={band.key}
        className={`flex shrink-0 items-start gap-2 border-b-2 border-border px-3 py-2 [@media(max-height:500px)]:py-1 ${style.background} ${style.text}`}
      >
        <div
          className={`flex min-w-0 flex-1 flex-col gap-1 [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:flex-wrap [@media(max-height:500px)]:items-baseline [@media(max-height:500px)]:gap-x-2`}
        >
          <div
            data-testid="state-line"
            className="text-sm font-bold tracking-wide"
          >
            <span data-testid="state-pill" className="uppercase">
              {band.text}
            </span>
            {inState !== null && (
              <span data-testid="state-time"> · {inState}</span>
            )}
          </div>
          {project && (
            <span data-testid="project" className="truncate text-xs">
              {project}
            </span>
          )}
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-1 text-xs">
              {tags.slice(0, MAX_TAGS).map((tag) => (
                <li
                  key={tag.key}
                  data-testid="tag"
                  className="max-w-full truncate border border-bg-dark px-1"
                >
                  #{tagLabels.get(tag.key) ?? tag.name}
                </li>
              ))}
              {tags.length > MAX_TAGS && (
                <li data-testid="tags-more" className="px-1">
                  +{tags.length - MAX_TAGS}
                </li>
              )}
            </ul>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 bg-bg-dark px-2 text-lg leading-none text-text hover:bg-btn-hover"
        >
          ×
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 [@media(max-height:500px)]:flex-none [@media(max-height:500px)]:gap-1 [@media(max-height:500px)]:p-2">
        <h2 className="line-clamp-2 shrink-0 text-lg leading-[1.15] font-bold break-words [@media(max-height:500px)]:line-clamp-1">
          {session.deskName ?? folderName(session.cwd)}
        </h2>
        {box}
        {session.currentTodo && (
          <p data-testid="current-todo" className="shrink-0 text-xs">
            {session.currentTodo}
          </p>
        )}
        {ended ? null : remoteControl ? (
          <a
            data-testid="remote-control-link"
            href={remoteControl}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 border-2 border-bg-dark px-3 py-3 [@media(max-height:500px)]:py-1 text-center font-bold uppercase shadow-[3px_3px_0_var(--color-bg-dark)] ${
              approving
                ? "bg-approve text-bg-dark hover:brightness-110"
                : "bg-accent hover:bg-accent-bright"
            }`}
          >
            {approving
              ? "Approve in Remote Control ↗"
              : "Open Remote Control ↗"}
          </a>
        ) : (
          <p className="shrink-0 text-xs text-text-muted">Remote Control off</p>
        )}
        <StepsList key={sessionKey(session)} session={session} />
        <p className="shrink-0 truncate text-xs text-text-muted">
          {session.machineName}
          {" · "}
          <span data-testid="folder" title={session.cwd}>
            {shortenPath(session.cwd)}
          </span>
        </p>
      </div>
    </aside>
  );
}
