import { describe, expect, it } from "vitest";
import { employeeNameToSend } from "./renameRule";

describe("saving an employee's name", () => {
  const automaticName = "Fix the login bug";

  it("sends an empty name for a blank or the automatic name when the owner had named it, and nothing when there was no owner's name to clear", () => {
    // Given an employee the owner named
    const named = { ownerName: "Login fixer", automaticName };
    // When the owner saves a blank, spaces, or the automatic name itself
    // Then each takes the owner's name away
    expect(employeeNameToSend("", named)).toBe("");
    expect(employeeNameToSend("   ", named)).toBe("");
    expect(employeeNameToSend(" Fix the login bug ", named)).toBe("");

    // And for an unnamed employee the same saves change nothing
    const unnamed = { automaticName };
    expect(employeeNameToSend("", unnamed)).toBeNull();
    expect(employeeNameToSend(automaticName, unnamed)).toBeNull();

    // And a new name is sent trimmed on one line; the same name sends nothing
    expect(employeeNameToSend("  Bug \n squasher ", named)).toBe(
      "Bug squasher",
    );
    expect(employeeNameToSend("Login fixer", named)).toBeNull();
  });
});
