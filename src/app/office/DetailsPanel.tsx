import { useState } from "react";
import type { MacBlock } from "@/office/offline";
import { remoteControlUrl } from "@/office/remoteControl";
import { employeeName } from "@/shared/employee-name";
import type { FolderDto } from "@/shared/folders";
import { ordinal, type Place } from "@/shared/list-order";
import { type SessionDto, sessionKey } from "@/shared/session";
import { DismissControl } from "./DismissControl";
import { formatElapsed } from "./elapsed";
import { RenameEmployeeDialog } from "./RenameEmployeeDialog";
import { RequestPopup } from "./RequestPopup";
import { type BandKey, bandOf } from "./rowText";
import { StepsList } from "./StepsList";
import { useNow } from "./useNow";
import { WakeControl } from "./WakeControl";

/** What the owner has done to order the selected employee (wake or dismiss): the click in flight, the order to follow, or the server's refusal. */
export interface OrderClickState {
  /** Set from the click until the server answers, so a second click cannot send a second order. */
  sending?: true;
  orderId?: string;
  error?: string;
}

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
  /** Stacks above a list sheet, so a card opened from that list sits on top of it. */
  raised?: boolean;
  onClose: () => void;
  /** Known folders of every Mac, to warn when the start folder is untrusted. */
  folders?: FolderDto[];
  /** Why the session's Mac cannot take orders; absent when it can. */
  macBlock?: MacBlock;
  /** The wake the owner gave this employee, kept by the page so reselecting shows it again. */
  wake?: OrderClickState;
  /** Sends one wake order for the employee. */
  onWake?: () => void;
  /** The dismiss the owner gave this employee, kept by the page so reselecting shows it again. */
  dismiss?: OrderClickState;
  /** Whether the employee's Mac has an agent that closes the window on Dismiss; true when not given. */
  dismissClosesWindow?: boolean;
  /** Sends one dismiss order for the employee; `endRunning` once the owner confirmed the warning pop-up. */
  onDismiss?: (endRunning: boolean) => void;
  /** Sends the owner's name for the employee; resolves true when the server stored it. */
  onRename?: (name: string) => Promise<boolean>;
  /** Moves the employee's Review to Idle. */
  onMoveToIdle?: () => void;
  /** Why the last move to Idle was refused; absent when it was not. */
  moveToIdleError?: string;
  /** Where the employee stands in the company's list; absent for one that went home. */
  place?: Place;
  /** Why the last Move to top or bottom was refused; absent when it was not. */
  placeError?: string;
  /** Moves the employee's row to the top of the list. */
  onMoveToTop?: () => void;
  /** Moves the employee's row to the bottom of the list. */
  onMoveToBottom?: () => void;
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
  review: { background: "bg-room-review", text: "text-bg-dark" },
  idle: { background: "bg-room-idle", text: "text-bg-dark" },
  wentHome: { background: "bg-pill-offline", text: "text-text" },
  offline: { background: "bg-pill-offline", text: "text-text" },
  notRunning: { background: "bg-pill-offline", text: "text-text" },
  waitingAtMac: { background: "bg-room-permission", text: "text-bg-dark" },
  starting: { background: "bg-room-idle", text: "text-bg-dark" },
} satisfies Record<BandKey, BandStyle>;

/** Tags shown on the card before the rest fold into "+N". */
const MAX_TAGS = 3;

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
    const latest = running.at(-1);
    text = latest ? latest.text : "working…";
    since = latest?.startedAt;
  } else if (session.state === "thinking") text = "thinking…";
  else if (session.state === "waitingForYou") text = "waiting for your reply";
  else if (session.state === "idle" || session.state === "review")
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
 * One of the two place buttons; at the end of the list it does nothing, so no empty request is sent.
 * @param props - The label, whether the row is already there, and the click handler.
 * @returns The button.
 */
function PlaceButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className="flex-1 border-2 border-bg-dark bg-btn-bg px-2 py-2 text-xs font-bold uppercase hover:bg-btn-hover aria-disabled:opacity-40 aria-disabled:hover:bg-btn-bg"
    >
      {label}
    </button>
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
  raised = false,
  onClose,
  folders = [],
  macBlock,
  wake,
  onWake,
  dismiss,
  onDismiss,
  dismissClosesWindow = true,
  onRename,
  onMoveToIdle,
  moveToIdleError,
  place,
  placeError,
  onMoveToTop,
  onMoveToBottom,
}: DetailsPanelProps & { session: SessionDto }) {
  // The browser's clock moved onto the server's, so a phone clock minutes off still shows right times.
  const nowMs = useNow() + serverOffsetMs;
  const [renaming, setRenaming] = useState(false);
  const automaticName = employeeName({
    deskName: session.deskName,
    cwd: session.cwd,
  });
  // A session with no process has nothing left to control, so it gets no link and no "off" message.
  const ended = session.state === "wentHome" || session.notRunning === true;
  const launching = session.waitingAtMac === true || session.starting === true;
  const offline = offlineMachineIds.has(session.machineId);
  const approving = session.state === "needsPermission" && !offline;
  const band = bandOf(session, offline, { short: true });
  const style = BAND_STYLES[band.key];
  const remoteControl = remoteControlUrl(session.bridgeSessionId);
  // A Mac that is offline says nothing about how long the session has been in its state; rows from before the stamp have none.
  const inState =
    (offline && !session.notRunning) || !session.stateSince
      ? null
      : formatElapsed(nowMs - Date.parse(session.stateSince));
  const box =
    offline || session.notRunning || launching ? null : boxOf(session, nowMs);
  const tags = session.tags ?? [];
  // The desktop card starts below the repo pill's spot, tags or not, so it never covers the pill or jumps.
  return (
    <aside
      data-testid="details-panel"
      className={`absolute ${sheet && raised ? "z-[75]" : "z-[60]"} flex flex-col border-2 border-border bg-bg text-sm [@media(max-height:500px)]:overflow-y-auto ${
        sheet
          ? "inset-x-0 bottom-0 max-h-[80%] border-x-0 border-b-0"
          : "top-[60px] left-2 max-h-[calc(100%-68px)] w-[360px] max-w-[calc(100%-1rem)] shadow-[6px_6px_0_var(--color-bg-dark)]"
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
        <div className="flex shrink-0 items-start gap-8">
          <h2 className="line-clamp-2 min-w-0 flex-1 text-lg leading-[1.15] font-bold break-words [@media(max-height:500px)]:line-clamp-1">
            {employeeName(session)}
          </h2>
          {onRename && (
            <button
              type="button"
              aria-label="Rename employee"
              onClick={() => setRenaming(true)}
              className="shrink-0 px-8 text-lg leading-none hover:bg-btn-hover"
            >
              ✎
            </button>
          )}
          {renaming && onRename && (
            <RenameEmployeeDialog
              key={sessionKey(session)}
              ownerName={session.ownerName}
              automaticName={automaticName}
              onSave={onRename}
              onClose={() => setRenaming(false)}
            />
          )}
          {session.request && (
            <RequestPopup key={sessionKey(session)} request={session.request} />
          )}
        </div>
        {box}
        {session.currentTodo && (
          <p data-testid="current-todo" className="shrink-0 text-xs">
            {session.currentTodo}
          </p>
        )}
        {launching && (
          <p data-testid="launch-note" className="shrink-0 text-xs">
            {session.waitingAtMac
              ? "The window is asking whether to trust the folder. At the Mac, trust the folder, then click the window before typing."
              : "Starting on the Mac."}
          </p>
        )}
        {session.state === "review" && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={onMoveToIdle}
              className="border-2 border-bg-dark bg-btn-bg px-3 py-3 text-center font-bold uppercase shadow-[3px_3px_0_var(--color-bg-dark)] hover:bg-btn-hover [@media(max-height:500px)]:py-1"
            >
              Move to Idle
            </button>
            {moveToIdleError && (
              <p role="alert" className="text-xs font-bold">
                {moveToIdleError}
              </p>
            )}
            <p data-testid="move-to-idle-note" className="text-xs">
              Moving to Idle means you have seen the result. It stays in your
              list, in the same place.
            </p>
          </div>
        )}
        {ended || launching ? null : remoteControl ? (
          <a
            data-testid="remote-control-link"
            href={remoteControl}
            // With no target iOS can hand the claude.ai/code link to the Claude app; a computer keeps a new tab.
            target={sheet ? undefined : "_blank"}
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
        {place && (
          <div
            data-testid="list-place"
            className="flex shrink-0 flex-col gap-1 border-2 border-border bg-bg-dark px-3 py-2 [@media(max-height:500px)]:py-1"
          >
            <span className="text-xs text-text-muted uppercase">
              Place in your list · now {ordinal(place.index + 1)} of{" "}
              {place.total}
            </span>
            <div className="flex gap-2">
              <PlaceButton
                label="Move to top"
                disabled={place.index === 0}
                onClick={onMoveToTop}
              />
              <PlaceButton
                label="Move to bottom"
                disabled={place.index === place.total - 1}
                onClick={onMoveToBottom}
              />
            </div>
            {placeError && (
              <p role="alert" className="text-xs font-bold">
                {placeError}
              </p>
            )}
          </div>
        )}
        {ended && (
          <WakeControl
            block={macBlock}
            untrusted={folders.some(
              (folder) =>
                folder.machineId === session.machineId &&
                folder.path === (session.startCwd ?? session.cwd) &&
                folder.cliTrusted === false,
            )}
            wake={wake}
            onWake={onWake}
          />
        )}
        {/* The agent stops keeping a desk before it marks the order done, so the outcome outlives the button. */}
        {(session.kept || dismiss) && (
          <DismissControl
            kept={session.kept !== undefined}
            block={macBlock}
            dismiss={dismiss}
            onDismiss={onDismiss}
            session={session}
            closesWindow={dismissClosesWindow}
          />
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
