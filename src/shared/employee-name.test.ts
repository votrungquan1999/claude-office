import { describe, expect, it } from "vitest";
import { employeeName, folderName } from "./employee-name";

describe("an employee's shown name", () => {
  it("is the owner's name when there is one, else the desk name, else the folder's name", () => {
    // Given the three sources of a name
    const cwd = "/Users/q/work/claude-office";

    // When each is present or absent
    // Then the owner's name beats the desk name, which beats the folder
    expect(
      employeeName({ ownerName: "Login fixer", deskName: "Fix bug", cwd }),
    ).toBe("Login fixer");
    expect(employeeName({ deskName: "Fix bug", cwd })).toBe("Fix bug");
    expect(employeeName({ cwd })).toBe("claude-office");
    expect(folderName("/")).toBe("/");
  });
});
