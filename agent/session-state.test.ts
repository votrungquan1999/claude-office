import { describe, expect, it } from "vitest";
import type { HookEvent } from "../src/shared/hook-events";
import type { SessionState } from "../src/shared/session-state";
import {
  applyRegistryStatus,
  initialStateMemory,
  reduceState,
} from "./session-state";

/** Feeds events in order and returns the state after each one. */
function states(events: Array<Partial<HookEvent>>): SessionState[] {
  let memory = initialStateMemory();
  return events.map((event, index) => {
    memory = reduceState(memory, {
      hook_event_name: "Stop",
      session_id: "s1",
      hookTs: index,
      ...event,
    });
    return memory.state;
  });
}

const pre = (
  id: string,
  extra: Partial<HookEvent> = {},
): Partial<HookEvent> => ({
  hook_event_name: "PreToolUse",
  tool_name: "Read",
  tool_use_id: id,
  ...extra,
});
const post = (
  id: string,
  extra: Partial<HookEvent> = {},
): Partial<HookEvent> => ({
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_use_id: id,
  ...extra,
});

describe("session state rules", () => {
  it("stays working until the last of several parallel tools finishes", () => {
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("a"),
        pre("b"),
        post("a"),
        post("b"),
      ]),
    ).toEqual(["thinking", "working", "working", "working", "thinking"]);
  });

  it("lets subagent tools keep the parent working but never wake it after the turn ended", () => {
    const sub = { agent_id: "sub1" };
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("p", { tool_name: "Agent" }),
        pre("x", sub),
        post("x", sub),
        { hook_event_name: "Stop" },
        pre("y", sub),
        post("y", sub),
      ]),
    ).toEqual([
      "thinking",
      "working",
      "working",
      "working",
      "idle",
      "idle",
      "idle",
    ]);
  });

  it("shows needs permission for every dialog that waits for the owner, and returns when it closes", () => {
    const turn = { hook_event_name: "UserPromptSubmit" };
    const dialogs: Array<Partial<HookEvent>> = [
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      },
      {
        hook_event_name: "Notification",
        notification_type: "elicitation_dialog",
      },
      {
        hook_event_name: "Notification",
        notification_type: "elicitation_url_dialog",
      },
      {
        hook_event_name: "Notification",
        notification_type: "agent_needs_input",
      },
      { hook_event_name: "Elicitation" },
      pre("q", { tool_name: "AskUserQuestion" }),
    ];
    for (const dialog of dialogs) {
      expect(states([turn, dialog]), JSON.stringify(dialog)).toEqual([
        "thinking",
        "needsPermission",
      ]);
    }

    // And each way a dialog closes puts the employee back to work
    const closers: Array<[Partial<HookEvent>, string]> = [
      [{ hook_event_name: "PermissionDenied", tool_name: "Bash" }, "thinking"],
      [{ hook_event_name: "ElicitationResult" }, "thinking"],
      [
        {
          hook_event_name: "Notification",
          notification_type: "elicitation_complete",
        },
        "thinking",
      ],
      [pre("next"), "working"],
      [{ hook_event_name: "UserPromptSubmit" }, "thinking"],
    ];
    const open: Partial<HookEvent> = {
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
    };
    for (const [closer, expected] of closers) {
      expect(states([turn, open, closer]).at(-1), JSON.stringify(closer)).toBe(
        expected,
      );
    }
    // The AskUserQuestion tool's own Post closes its dialog
    expect(
      states([
        turn,
        pre("q", { tool_name: "AskUserQuestion" }),
        post("q", { tool_name: "AskUserQuestion" }),
      ]),
    ).toEqual(["thinking", "needsPermission", "thinking"]);
  });

  it("goes back to thinking after a failed tool, and to idle after an interrupt or a failed turn", () => {
    const turn = { hook_event_name: "UserPromptSubmit" };
    const failure = (id: string, extra: Partial<HookEvent> = {}) =>
      post(id, { hook_event_name: "PostToolUseFailure", ...extra });
    expect(states([turn, pre("a"), failure("a")])).toEqual([
      "thinking",
      "working",
      "thinking",
    ]);
    expect(
      states([turn, pre("a"), pre("b"), failure("a", { is_interrupt: true })]),
    ).toEqual(["thinking", "working", "working", "idle"]);
    expect(
      states([turn, pre("a"), { hook_event_name: "StopFailure" }]),
    ).toEqual(["thinking", "working", "idle"]);
  });

  it("ignores a Pre that arrives after its Post, and a late idle prompt once a new turn started", () => {
    const turn = { hook_event_name: "UserPromptSubmit" };
    const idle = {
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
    };
    expect(states([turn, pre("a"), post("a"), pre("a")])).toEqual([
      "thinking",
      "working",
      "thinking",
      "thinking",
    ]);
    expect(states([{ hook_event_name: "Stop" }, idle, turn, idle])).toEqual([
      "idle",
      "idle",
      "thinking",
      "thinking",
    ]);
  });

  it("still ignores a late Pre for a tool after many later tools have closed", () => {
    const turn = { hook_event_name: "UserPromptSubmit" };
    const later = ["b", "c", "d", "e", "f"].flatMap((id) => [
      pre(id),
      post(id),
    ]);
    const all = states([turn, pre("a"), post("a"), ...later, pre("a")]);
    expect(all.at(-1)).toBe("thinking");
  });

  it("keeps the tool a permission dialog names when the dialog's notification arrives, so the tool finishing closes it", () => {
    const permission = {
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
    };
    const notification = {
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
    };
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("b1", { tool_name: "Bash" }),
        permission,
        notification,
        post("b1", { tool_name: "Bash" }),
      ]),
    ).toEqual([
      "thinking",
      "working",
      "needsPermission",
      "needsPermission",
      "thinking",
    ]);
  });

  it("stays needs permission until the last of several open dialogs is answered, even while other tools start and finish", () => {
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("a", { tool_name: "Read" }),
        { hook_event_name: "PermissionRequest", tool_name: "Read" },
        pre("b", { tool_name: "Bash" }),
        { hook_event_name: "PermissionRequest", tool_name: "Bash" },
        post("a", { tool_name: "Read" }),
        post("b", { tool_name: "Bash" }),
      ]),
    ).toEqual([
      "thinking",
      "working",
      "needsPermission",
      "needsPermission",
      "needsPermission",
      "needsPermission",
      "thinking",
    ]);
  });

  it("answers one of two open dialogs at a time", () => {
    const open = { hook_event_name: "PermissionRequest", tool_name: "Bash" };
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        open,
        open,
        { hook_event_name: "PermissionDenied", tool_name: "Bash" },
        { hook_event_name: "PermissionDenied", tool_name: "Bash" },
      ]),
    ).toEqual([
      "thinking",
      "needsPermission",
      "needsPermission",
      "needsPermission",
      "thinking",
    ]);
  });

  it("moves the parent to needs permission when a subagent asks, and back when its tool finishes", () => {
    const sub = { agent_id: "sub1" };
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("p", { tool_name: "Agent" }),
        pre("x", { ...sub, tool_name: "Bash" }),
        { hook_event_name: "PermissionRequest", tool_name: "Bash", ...sub },
        {
          hook_event_name: "Notification",
          notification_type: "permission_prompt",
          ...sub,
        },
        post("x", { ...sub, tool_name: "Bash" }),
      ]),
    ).toEqual([
      "thinking",
      "working",
      "working",
      "needsPermission",
      "needsPermission",
      "working",
    ]);
  });

  it("closes the dialog a subagent opened when its tool is denied or fails", () => {
    const sub = { agent_id: "sub1" };
    const open = [
      { hook_event_name: "UserPromptSubmit" },
      pre("p", { tool_name: "Agent" }),
      pre("x", { ...sub, tool_name: "Bash" }),
      { hook_event_name: "PermissionRequest", tool_name: "Bash", ...sub },
    ] as Array<Partial<HookEvent>>;
    const denied = states([
      ...open,
      { hook_event_name: "PermissionDenied", tool_name: "Bash", ...sub },
    ]);
    const failed = states([
      ...open,
      {
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: "x",
        ...sub,
      },
    ]);
    expect(denied.at(-1)).toBe("working");
    expect(failed.at(-1)).toBe("working");
  });

  it("keeps the state a compaction interrupts instead of resetting it", () => {
    expect(
      states([
        { hook_event_name: "UserPromptSubmit" },
        pre("a", { tool_name: "Bash" }),
        { hook_event_name: "SessionStart", source: "compact" },
        post("a", { tool_name: "Bash" }),
        { hook_event_name: "SessionStart", source: "resume" },
      ]),
    ).toEqual(["thinking", "working", "working", "thinking", "idle"]);
  });

  it("treats a busy registry status after a permission request as the dialog being approved", () => {
    let memory = initialStateMemory();
    for (const event of [
      { hook_event_name: "UserPromptSubmit" },
      pre("a", { tool_name: "Bash" }),
      { hook_event_name: "PermissionRequest", tool_name: "Bash" },
    ]) {
      memory = reduceState(memory, {
        session_id: "s1",
        hookTs: 1,
        ...event,
      } as HookEvent);
    }
    expect(memory.state).toBe("needsPermission");
    expect(applyRegistryStatus(memory, "busy").state).toBe("working");
  });

  it("ends a turn the hooks saw start when the registry says idle", () => {
    // Given a session the hooks left thinking
    const memory = reduceState(initialStateMemory(), {
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      prompt: "go",
      hookTs: 1,
    } as HookEvent);
    expect(memory.state).toBe("thinking");

    // Then the registry's idle puts it in Idle
    expect(applyRegistryStatus(memory, "idle").state).toBe("idle");
  });
});
