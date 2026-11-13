import { describe, expect, it } from "vitest";
import { type SessionDto, sessionKey } from "@/shared/session";
import { applyEmployeeNames, settleEmployeeNames } from "./employeeName";

const session = (sessionId: string, ownerName?: string): SessionDto => ({
  machineId: "m1",
  machineName: "Mac",
  sessionId,
  cwd: "/work",
  deskName: "Fix bug",
  state: "idle",
  startedAt: "2026-11-09T09:00:00.000Z",
  changedAt: "2026-11-09T09:00:00.000Z",
  ...(ownerName ? { ownerName } : {}),
});
const mapOf = (...sessions: SessionDto[]) =>
  new Map(sessions.map((s) => [sessionKey(s), s]));

describe("an employee name given on this device", () => {
  it("shows over the answers' name, a pending clear shows the automatic name, and other employees are untouched", () => {
    // Given one pending name and one pending clear
    const a = session("a");
    const b = session("b", "Old name");
    const c = session("c", "Keep me");
    const pending = new Map([
      [sessionKey(a), { name: "New name", storedAfterPoll: null }],
      [sessionKey(b), { name: "", storedAfterPoll: null }],
    ]);

    // When the pending names are laid over the sessions
    const shown = applyEmployeeNames(mapOf(a, b, c), pending);

    // Then the named one shows the new name, the cleared one has none, and the third is as it was
    expect(shown.get(sessionKey(a))?.ownerName).toBe("New name");
    expect(shown.get(sessionKey(b))).not.toHaveProperty("ownerName");
    expect(shown.get(sessionKey(c))?.ownerName).toBe("Keep me");
  });

  it("is dropped once an answer shows that name (or no name for a clear) or the employee is gone, and kept while the answer still shows the old name", () => {
    // Given a pending name and a pending clear
    const pending = new Map([
      ["m1/a", { name: "New name", storedAfterPoll: null }],
      ["m1/b", { name: "", storedAfterPoll: null }],
    ]);

    // When the answer still has the old names
    const stale = settleEmployeeNames(
      pending,
      mapOf(session("a", "Old"), session("b", "Old")),
      1,
    );
    // Then both are kept
    expect([...stale.keys()].sort()).toEqual(["m1/a", "m1/b"]);

    // When the answer has caught up, or the employees are gone
    const caughtUp = settleEmployeeNames(
      pending,
      mapOf(session("a", "New name"), session("b")),
      1,
    );
    const gone = settleEmployeeNames(pending, mapOf(), 1);
    // Then nothing is pending any more
    expect(caughtUp.size).toBe(0);
    expect(gone.size).toBe(0);
  });

  it("is dropped by the first answer to a poll started after the server stored it, even when that answer shows another name", () => {
    // Given a name the server stored after poll 2 started, while another device renamed the employee meanwhile
    const pending = new Map([
      ["m1/a", { name: "My name", storedAfterPoll: 2 }],
    ]);
    const elsewhere = mapOf(session("a", "Name from another device"));

    // When an answer to a poll that started before the server stored it arrives
    const older = settleEmployeeNames(pending, elsewhere, 2);
    // Then the name is kept, as that answer may still carry the old name
    expect(older.size).toBe(1);

    // When the answer to the next poll arrives
    const later = settleEmployeeNames(pending, elsewhere, 3);
    // Then the name is dropped, and the answer's name is the truth
    expect(later.size).toBe(0);
  });
});
