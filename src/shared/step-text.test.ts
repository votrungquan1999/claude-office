import { describe, expect, it } from "vitest";
import { stepText } from "./step-text";

describe("step text", () => {
  it("says what the tool did in plain words, never showing a command, and cuts long text", () => {
    // file tools: own verb plus the file name
    expect(stepText("Read", { file_name: "route.ts" })).toBe("Read route.ts");
    expect(stepText("Edit", { file_name: "route.ts" })).toBe("Edit route.ts");
    expect(stepText("Write", { file_name: "notes.md" })).toBe("Write notes.md");
    expect(stepText("Read", undefined)).toBe("Read");

    // Bash: its description, else just "Bash"
    expect(stepText("Bash", { description: "Run the tests" })).toBe(
      "Run the tests",
    );
    expect(stepText("Bash", undefined)).toBe("Bash");
    expect(stepText("Bash", { description: "  " })).toBe("Bash");

    // agents, searches and the web
    expect(stepText("Agent", { description: "Find the bug" })).toBe(
      "Agent: Find the bug",
    );
    expect(stepText("Grep", { pattern: "TODO" })).toBe("Search 'TODO'");
    expect(stepText("Glob", { pattern: "**/*.ts" })).toBe("Search '**/*.ts'");
    expect(stepText("WebSearch", { query: "vitest fake timers" })).toBe(
      "vitest fake timers",
    );
    expect(stepText("WebFetch", { domain: "docs.example.com" })).toBe(
      "docs.example.com",
    );

    // anything else: the tool name only
    expect(stepText("mcp__github__list_prs", undefined)).toBe(
      "mcp__github__list_prs",
    );
    expect(stepText("Skill", undefined)).toBe("Skill");
    expect(stepText(undefined, undefined)).toBe("Tool");

    // long text is cut to 120 characters with an ellipsis
    const long = stepText("Bash", { description: "x".repeat(300) });
    expect([...long]).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
