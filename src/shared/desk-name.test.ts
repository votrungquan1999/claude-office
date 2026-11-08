import { describe, expect, it } from "vitest";
import { firstRealMessage, resolveDeskName } from "./desk-name";

describe("desk name", () => {
  it("prefers the card summary, then the card title, then the first message, then the registry name, skipping blanks", () => {
    const all = {
      cardSummary: "Card summary",
      cardTitle: "Card title",
      firstMessage: "First message",
      registryName: "Registry name",
    };
    expect(resolveDeskName(all)).toBe("Card summary");
    expect(resolveDeskName({ ...all, cardSummary: "" })).toBe("Card title");
    expect(
      resolveDeskName({ ...all, cardSummary: "  ", cardTitle: undefined }),
    ).toBe("First message");
    expect(resolveDeskName({ registryName: "Registry name" })).toBe(
      "Registry name",
    );
    expect(resolveDeskName({})).toBeUndefined();
  });

  it("cuts the first message to 60 characters on one line, never splits an emoji, and skips commands, shell input and system blocks", () => {
    expect(firstRealMessage("  fix   the\nlogin\tbug ")).toBe(
      "fix the login bug",
    );
    expect(firstRealMessage("a".repeat(70))).toBe(`${"a".repeat(59)}…`);
    // an emoji (two UTF-16 units) is one character: kept whole at the cut, never left as half
    expect(firstRealMessage(`${"a".repeat(58)}😀 tail tail`)).toBe(
      `${"a".repeat(58)}😀…`,
    );
    expect(firstRealMessage("Sửa lỗi đăng nhập ".repeat(5))).toMatch(
      /^Sửa lỗi đăng nhập .*…$/,
    );
    for (const skipped of [
      "/clear",
      "/rename my-session",
      "<system-reminder>caveat</system-reminder>",
      "<command-name>/foo</command-name>",
      "!ls -la",
      "/compact",
      "<ide_opened_file>x.ts</ide_opened_file>",
      "<local-command-stdout>done</local-command-stdout>",
      "[Request interrupted by user]",
      "[Request interrupted by user for tool use]",
      "   ",
      "",
    ]) {
      expect(firstRealMessage(skipped), skipped).toBeUndefined();
    }
  });

  it("keeps a real first message that merely starts with a path or an angle bracket", () => {
    expect(firstRealMessage("/Users/me/app/x.ts crashes on load")).toBe(
      "/Users/me/app/x.ts crashes on load",
    );
    expect(firstRealMessage("<div> why is this broken")).toBe(
      "<div> why is this broken",
    );
    expect(firstRealMessage("/ is not mounted")).toBe("/ is not mounted");
  });

  it("strips any leading <tag>…</tag> block and uses the rest, or reports nothing when nothing is left", () => {
    expect(
      firstRealMessage(
        "<browser_instruction># Claude in Chrome automation\nuse tabs</browser_instruction> fix the login bug",
      ),
    ).toBe("fix the login bug");
    expect(firstRealMessage("<a>one</a><b x='1'>two</b>\nthen real text")).toBe(
      "then real text",
    );
    expect(
      firstRealMessage(
        "<browser_instruction>only injected</browser_instruction>",
      ),
    ).toBeUndefined();
    expect(firstRealMessage("<a>x</a>  <b>y</b>")).toBeUndefined();
    // the rest is judged by the same rules as any message
    expect(firstRealMessage("<a>x</a> /clear")).toBeUndefined();
  });
});
