import { asks } from "../src/shared/asks";
import type { HookEvent } from "../src/shared/hook-events";
import type { SessionState } from "../src/shared/session-state";

/** What the reducer remembers about a session between events. */
export interface StateMemory {
  /** The room the session belongs in, derived from the rest. */
  state: SessionState;
  /** Between tools: thinking during a turn, waiting otherwise. */
  base: "thinking" | "waiting";
  /** The turn that just ended asked the owner something; kept until the next prompt. */
  asked: boolean;
  /** `tool_use_id`s of tools that started and have not finished. */
  inFlight: string[];
  /** Recently finished ids, so a Pre delivered after its own Post is ignored. */
  closed: string[];
  /** One entry per open dialog waiting for the owner; it names the tool when the event did. */
  dialogs: Array<{ toolName?: string }>;
  /** Sub-agents that started and have not stopped; `announced` is true when a SubagentStart said so, false when only their tool events did. */
  subagents: Array<{ id: string; announced: boolean }>;
  /** Recently stopped sub-agent ids, so a late event of a finished sub-agent is ignored. */
  stoppedAgents: string[];
}

/** Notification types that mean a dialog is waiting for the owner. */
const OWNER_DIALOGS = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

function derive(memory: Omit<StateMemory, "state">): StateMemory {
  const state: SessionState =
    memory.dialogs.length > 0
      ? "needsPermission"
      : memory.inFlight.length > 0 ||
          (memory.base === "waiting" && memory.subagents.length > 0)
        ? "working"
        : memory.base === "waiting"
          ? memory.asked
            ? "waitingForYou"
            : "idle"
          : memory.base;
  return { ...memory, state };
}

/**
 * The memory of a session whose turn has ended.
 * @param asked - Whether that turn asked the owner something.
 * @returns The memory, in Waiting for you or Idle.
 */
export function initialStateMemory(asked = false): StateMemory {
  return derive({
    base: "waiting",
    asked,
    inFlight: [],
    closed: [],
    dialogs: [],
    subagents: [],
    stoppedAgents: [],
  });
}

/**
 * Replaces whether the ended turn asked the owner something.
 * @param memory - The memory of a session whose turn has ended.
 * @param asked - The new answer.
 * @returns The memory in Waiting for you or Idle; a session still in a turn is returned as it was.
 */
export function setAsked(memory: StateMemory, asked: boolean): StateMemory {
  return memory.base === "waiting" ? derive({ ...memory, asked }) : memory;
}

/**
 * Applies one event to a session's state memory.
 * @param memory - The memory so far.
 * @param event - The next event, in `hookTs` order.
 * @returns The new memory.
 */
export function reduceState(
  memory: StateMemory,
  event: HookEvent,
): StateMemory {
  const id = event.tool_use_id;
  if (event.agent_id) return reduceSubagent(memory, event);
  switch (event.hook_event_name) {
    case "SessionStart":
      // Auto-compaction happens mid-turn; the turn carries on as it was.
      return event.source === "compact" ? memory : initialStateMemory();
    case "Stop":
      // A follow-up Stop (a Stop hook ran another turn) keeps a question the earlier Stop asked.
      return derive({
        ...endedTurn(memory),
        asked:
          asks(event.last_assistant_message) ||
          (event.stop_hook_active === true && memory.asked),
      });
    case "StopFailure":
      return endedTurn(memory);
    case "UserPromptSubmit":
      return derive({
        base: "thinking",
        asked: false,
        inFlight: [],
        closed: [],
        dialogs: [],
        subagents: [],
        stoppedAgents: memory.stoppedAgents,
      });
    case "PreToolUse":
      return derive({
        base: "thinking",
        asked: memory.asked,
        closed: memory.closed,
        subagents: memory.subagents,
        stoppedAgents: memory.stoppedAgents,
        inFlight: startTool(memory, id),
        // A tool starting does not answer a dialog that names another tool; AskUserQuestion is itself a dialog.
        dialogs:
          event.tool_name === "AskUserQuestion"
            ? [...memory.dialogs, { toolName: event.tool_name }]
            : memory.dialogs.filter(({ toolName }) => toolName !== undefined),
      });
    case "PermissionRequest":
    case "Elicitation":
    case "Notification":
      return reduceDialogOpen(memory, event);
    case "PermissionDenied":
    case "ElicitationResult":
      return derive({
        ...memory,
        dialogs: closeDialog(memory.dialogs, event.tool_name, true),
      });
    case "PostToolUseFailure":
      // An interrupt ends the turn with no Stop event, so nothing else will say it is over.
      if (event.is_interrupt) return initialStateMemory();
      return reduceFinished(memory, event);
    case "PostToolUse":
      return reduceFinished(memory, event);
    default:
      return memory;
  }
}

/** A memory in the ended-turn state that keeps the sub-agents a SubagentStart announced: they may run on in the background. */
function endedTurn(memory: StateMemory): StateMemory {
  return {
    ...initialStateMemory(),
    subagents: memory.subagents.filter(({ announced }) => announced),
    stoppedAgents: memory.stoppedAgents,
  };
}

/** Opens a dialog for an event that asks the owner something; other notifications change nothing. */
function reduceDialogOpen(memory: StateMemory, event: HookEvent): StateMemory {
  if (event.hook_event_name !== "Notification") {
    return derive({
      ...memory,
      dialogs: [...memory.dialogs, { toolName: event.tool_name }],
    });
  }
  if (OWNER_DIALOGS.has(event.notification_type ?? "")) {
    // The notification of a dialog the request already named must not replace its tool name.
    return memory.dialogs.length > 0
      ? memory
      : derive({ ...memory, dialogs: [{}] });
  }
  return event.notification_type === "elicitation_complete"
    ? derive({
        ...memory,
        dialogs: closeDialog(memory.dialogs, undefined, true),
      })
    : memory;
}

const CLOSED_KEPT = 50;

/** Removes one dialog: the one naming `toolName`, else (when `orUnnamed`) one that names no tool. */
function closeDialog(
  dialogs: StateMemory["dialogs"],
  toolName: string | undefined,
  orUnnamed: boolean,
): StateMemory["dialogs"] {
  let at = dialogs.findIndex((dialog) => dialog.toolName === toolName);
  if (at < 0 && orUnnamed) at = dialogs.findIndex((d) => !d.toolName);
  return at < 0 ? dialogs : dialogs.filter((_, index) => index !== at);
}

function startTool(memory: StateMemory, id: string | undefined): string[] {
  return id && !memory.closed.includes(id)
    ? [...memory.inFlight, id]
    : memory.inFlight;
}

function finishTool(
  memory: StateMemory,
  id: string | undefined,
): Pick<StateMemory, "inFlight" | "closed"> {
  return {
    inFlight: memory.inFlight.filter((open) => open !== id),
    closed: id ? [...memory.closed, id].slice(-CLOSED_KEPT) : memory.closed,
  };
}

/** A tool ended (success or failure): it leaves the in-flight set and closes its own dialog. */
function reduceFinished(memory: StateMemory, event: HookEvent): StateMemory {
  return derive({
    base: "thinking",
    asked: memory.asked,
    subagents: memory.subagents,
    stoppedAgents: memory.stoppedAgents,
    ...finishTool(memory, event.tool_use_id),
    dialogs: closeDialog(memory.dialogs, event.tool_name, false),
  });
}

/** Records a sub-agent as running; a SubagentStart upgrades one only its tool events had shown. */
function trackAgent(
  memory: StateMemory,
  agentId: string,
  announced: boolean,
): StateMemory {
  const known = memory.subagents.find(({ id }) => id === agentId);
  if (known && (known.announced || !announced)) return memory;
  return {
    ...memory,
    subagents: [
      ...memory.subagents.filter(({ id }) => id !== agentId),
      { id: agentId, announced },
    ],
  };
}

/** Moves a sub-agent from running to stopped. */
function stopAgent(memory: StateMemory, agentId: string): StateMemory {
  return derive({
    ...memory,
    subagents: memory.subagents.filter(({ id }) => id !== agentId),
    stoppedAgents: [
      ...memory.stoppedAgents.filter((id) => id !== agentId),
      agentId,
    ].slice(-CLOSED_KEPT),
  });
}

/**
 * Subagent tools keep the parent working and a subagent's dialog blocks the parent; after the turn ended, a running
 * sub-agent alone keeps the desk working, and its tools and dialogs change nothing.
 */
function reduceSubagent(memory: StateMemory, event: HookEvent): StateMemory {
  const agentId = event.agent_id;
  if (!agentId) return memory;
  if (event.hook_event_name === "SubagentStop") {
    return stopAgent(memory, agentId);
  }
  if (memory.stoppedAgents.includes(agentId)) return memory;
  const tracked = trackAgent(
    memory,
    agentId,
    event.hook_event_name === "SubagentStart",
  );
  if (tracked.base === "waiting") return derive(tracked);
  return reduceSubagentTool(tracked, event);
}

/** A sub-agent's tool and dialog events during a turn. */
function reduceSubagentTool(
  memory: StateMemory,
  event: HookEvent,
): StateMemory {
  const id = event.tool_use_id;
  switch (event.hook_event_name) {
    case "PermissionRequest":
    case "Notification":
      return reduceDialogOpen(memory, event);
    case "PreToolUse":
      return id
        ? derive({ ...memory, inFlight: startTool(memory, id) })
        : memory;
    case "PostToolUse":
    case "PostToolUseFailure":
      return id
        ? derive({
            ...memory,
            ...finishTool(memory, id),
            dialogs: closeDialog(memory.dialogs, event.tool_name, false),
          })
        : memory;
    case "PermissionDenied":
      return derive({
        ...memory,
        dialogs: closeDialog(memory.dialogs, event.tool_name, true),
      });
    default:
      return memory;
  }
}

/**
 * Applies an event stamped before one already applied: only a close changes anything, so a straggler never moves the room back.
 * @param memory - The memory so far.
 * @param event - The late event.
 * @returns The memory with the event's own tool or dialog closed; the base and every other open tool are kept.
 */
export function reduceLate(memory: StateMemory, event: HookEvent): StateMemory {
  switch (event.hook_event_name) {
    case "SubagentStop":
      return event.agent_id ? stopAgent(memory, event.agent_id) : memory;
    case "PostToolUse":
    case "PostToolUseFailure":
      return derive({
        ...memory,
        ...finishTool(memory, event.tool_use_id),
        dialogs: closeDialog(memory.dialogs, event.tool_name, false),
      });
    case "PermissionDenied":
      return derive({
        ...memory,
        dialogs: closeDialog(memory.dialogs, event.tool_name, true),
      });
    default:
      return memory;
  }
}

/**
 * Brings a session's state in line with the registry's status.
 * @param memory - What the hooks established so far.
 * @param status - Claude Code's own status for the session.
 * @returns The new memory; `busy` never demotes a state the hooks know better.
 */
export function applyRegistryStatus(
  memory: StateMemory,
  status: "idle" | "busy" | "waiting",
): StateMemory {
  switch (status) {
    case "idle":
      // After a turn ended, idle closes any dialog but keeps the question the turn asked.
      return memory.base === "waiting"
        ? derive({ ...memory, dialogs: [], subagents: [] })
        : initialStateMemory();
    case "waiting":
      return derive({
        ...memory,
        dialogs: memory.dialogs.length > 0 ? memory.dialogs : [{}],
      });
    case "busy":
      // Busy after a dialog opened means the owner answered it.
      return memory.base === "waiting" || memory.dialogs.length > 0
        ? derive({ ...memory, base: "thinking", dialogs: [] })
        : memory;
  }
}
