import type { HookEvent } from "../src/shared/hook-events";
import type { StepDto } from "../src/shared/session";
import { stepText } from "../src/shared/step-text";

/** A step as the tracker sees it, before it gets an id and a machine. */
export interface FinishedStep {
  text: string;
  startedAt: number;
  /** Run time in ms; absent when the step was closed while still running. */
  durationMs?: number;
  status: StepDto["status"];
}

interface RunningStep {
  text: string;
  startedAt: number;
}

/** What the step rules remember about a session between events. */
export interface StepMemory {
  /** Started tools by `tool_use_id`. */
  running: Map<string, RunningStep>;
  /** Recently finished ids, so a Pre delivered after its own Post, or a repeated Post, adds nothing. */
  closed: string[];
  /** The in-progress to-do line, set by the latest TodoWrite. */
  todo: string | null;
  /** `hookTs` of the newest event that closed every running step; a start stamped before it is a straggler. */
  closedAt: number;
  /** True once the current turn's API failure was shown; a repeat of it adds nothing until the next prompt. */
  apiErrorShown: boolean;
}

const CLOSED_KEPT = 50;

export function initialStepMemory(): StepMemory {
  return {
    running: new Map(),
    closed: [],
    todo: null,
    closedAt: -Infinity,
    apiErrorShown: false,
  };
}

/** Events that end a turn or session; each closes any step still running. */
const SESSION_CLOSERS = new Set(["Stop", "StopFailure", "SessionEnd"]);

/**
 * Applies one event to a session's steps, in `hookTs` order.
 * @param memory - The memory so far; it is updated in place.
 * @param event - The next event.
 * @returns The steps that finished because of this event.
 */
export function reduceSteps(
  memory: StepMemory,
  event: HookEvent,
): FinishedStep[] {
  // A subagent's tools show up as the parent's one Agent step.
  if (event.agent_id) return [];
  const name = event.hook_event_name;
  if (name === "UserPromptSubmit" || name === "SessionStart") {
    memory.apiErrorShown = false;
    return [];
  }
  if (name === "PreToolUse") {
    startStep(memory, event);
    return [];
  }
  if (name === "PostToolUse" || name === "PostToolUseFailure") {
    const finished = finishStep(memory, event, endStatus(event));
    // An interrupt stops the sibling tools too, and they may never report it themselves.
    if (event.is_interrupt) {
      finished.push(...closeRunning(memory));
      memory.closedAt = Math.max(memory.closedAt, event.hookTs);
    }
    return finished;
  }
  if (name === "PermissionDenied") return finishStep(memory, event, "denied");
  if (SESSION_CLOSERS.has(name)) {
    const finished = closeRunning(memory);
    memory.closedAt = Math.max(memory.closedAt, event.hookTs);
    if (name === "StopFailure" && !memory.apiErrorShown) {
      memory.apiErrorShown = true;
      finished.push({
        text: "API error",
        startedAt: event.hookTs,
        status: "failed" as const,
      });
    }
    return finished;
  }
  return [];
}

/**
 * Closes every step still running as stopped.
 * @param memory - The memory; its running steps are cleared.
 * @returns The closed steps, oldest first.
 */
export function closeRunning(memory: StepMemory): FinishedStep[] {
  const finished: FinishedStep[] = [...memory.running.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((step) => ({ ...step, status: "stopped" }));
  // A late Post for a step closed here must not add it a second time.
  memory.closed = [...memory.closed, ...memory.running.keys()].slice(
    -CLOSED_KEPT,
  );
  memory.running.clear();
  return finished;
}

function endStatus(event: HookEvent): StepDto["status"] {
  if (event.hook_event_name !== "PostToolUseFailure") return "ok";
  return event.is_interrupt ? "stopped" : "failed";
}

function startStep(memory: StepMemory, event: HookEvent): void {
  if (event.tool_name === "TodoWrite") {
    memory.todo = event.tool_input?.activeTodo ?? null;
    return;
  }
  const id = event.tool_use_id;
  if (!id || memory.closed.includes(id) || event.hookTs < memory.closedAt) {
    return;
  }
  memory.running.set(id, {
    text: stepText(event.tool_name, event.tool_input),
    startedAt: event.hookTs,
  });
}

function finishStep(
  memory: StepMemory,
  event: HookEvent,
  status: StepDto["status"],
): FinishedStep[] {
  if (event.tool_name === "TodoWrite") return [];
  const id = event.tool_use_id;
  if (id && memory.closed.includes(id)) return [];
  const started = id ? memory.running.get(id) : undefined;
  if (id) {
    memory.running.delete(id);
    memory.closed = [...memory.closed, id].slice(-CLOSED_KEPT);
  }
  // Hook processes boot at uneven speeds, so a reported end can be stamped before its start; the run time never goes below zero.
  // Without the matching start (Post delivered first), the event's own timing and input stand in.
  const durationMs =
    event.duration_ms ??
    (started ? Math.max(0, event.hookTs - started.startedAt) : undefined);
  return [
    {
      text: started?.text ?? stepText(event.tool_name, event.tool_input),
      startedAt: started?.startedAt ?? event.hookTs - (event.duration_ms ?? 0),
      ...(durationMs === undefined ? {} : { durationMs }),
      status,
    },
  ];
}
