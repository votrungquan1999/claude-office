import { describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import { bandOf, contextLineOf } from "./rowText";

/** A session with only what the row text reads. */
function session(extra: Partial<SessionDto>): SessionDto {
  return {
    machineId: "m",
    machineName: "Mac",
    sessionId: "s",
    cwd: "/work",
    state: "idle",
    startedAt: "2026-11-01T00:00:00.000Z",
    changedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

const step = (text: string) => ({
  text,
  startedAt: "2026-11-01T00:00:00.000Z",
});
const finished = (text: string) => ({
  id: text,
  text,
  startedAt: "2026-11-01T00:00:00.000Z",
  status: "ok" as const,
});

describe("a row's state word and context line", () => {
  it("says what each state is doing, and an overlay never reads as the room it sits in", () => {
    // Given sessions in every state and overlay
    const cases: Array<[SessionDto, boolean]> = [
      [
        session({
          state: "working",
          runningSteps: [step("Read a.ts"), step("Edit b.ts")],
        }),
        false,
      ],
      [session({ state: "working" }), false],
      [session({ state: "thinking" }), false],
      [
        session({ state: "thinking", recentSteps: [finished("Read d.ts")] }),
        false,
      ],
      [
        session({ state: "needsPermission", runningSteps: [step("Bash ls")] }),
        false,
      ],
      [
        session({
          state: "needsPermission",
          runningSteps: [step("Bash ls"), step("Bash pwd")],
        }),
        false,
      ],
      [session({ state: "waitingForYou" }), false],
      [
        session({ state: "review", recentSteps: [finished("Write doc")] }),
        false,
      ],
      [session({ state: "idle", recentSteps: [finished("Run tests")] }), false],
      [session({ state: "idle" }), false],
      [
        session({
          state: "idle",
          runningSteps: [step("Read c.ts")],
          recentSteps: [finished("Run tests")],
        }),
        false,
      ],
      [session({ state: "working", runningSteps: [step("Edit b.ts")] }), true],
      [session({ state: "idle", notRunning: true }), false],
      [session({ state: "idle", waitingAtMac: true }), false],
      [session({ state: "idle", starting: true }), false],
    ];

    // When each row's text is worked out
    const text = cases.map(([s, offline]) => [
      bandOf(s, offline).text,
      contextLineOf(s, offline),
    ]);

    // Then the word and the line follow one rule
    expect(text).toEqual([
      ["Working", "Edit b.ts"],
      ["Working", "working…"],
      ["Thinking", null],
      ["Thinking", "Read d.ts"],
      ["Needs permission", "wants to run: Bash ls"],
      ["Needs permission", "wants to run"],
      ["Waiting for you", "waiting for your reply"],
      ["Review", null],
      ["Idle", "last: Run tests"],
      ["Idle", null],
      ["Idle", "last: Read c.ts"],
      ["Mac offline", null],
      ["Not running", null],
      ["Waiting at the Mac", null],
      ["Starting", null],
    ]);
  });
});
