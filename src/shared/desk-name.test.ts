import { describe, expect, it } from "vitest";
import {
  firstRealMessage,
  isPasteOnly,
  pasteHeadOf,
  requestOf,
  resolveDeskName,
} from "./desk-name";

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

  it("names a paste-only message 'Pasted text', and lets the owner's /rename beat that placeholder but not a card", () => {
    const paste =
      '<pasted_content id="d296">\n\nsome long text</pasted_content id="d296">';
    // a paste alone, an unclosed short paste, and the hook's body-less placeholder
    for (const only of [
      paste,
      `\n\n${paste}  `,
      '<pasted_content id="d1">cut off',
      "<pasted_content/>",
    ]) {
      expect(firstRealMessage(only), only).toBe("Pasted text");
      expect(isPasteOnly(only), only).toBe(true);
    }
    // typed words, a command after the paste, and ordinary tags are not paste-only
    expect(isPasteOnly(`${paste} hello`)).toBe(false);
    expect(firstRealMessage(`${paste} /clear`)).toBeUndefined();
    expect(isPasteOnly("<a>x</a> <b>y</b>")).toBe(false);
    // the placeholder yields to /rename, never to nothing, and a card still wins
    expect(
      resolveDeskName({ firstMessage: "Pasted text", registryName: "My name" }),
    ).toBe("My name");
    expect(resolveDeskName({ firstMessage: "Pasted text" })).toBe(
      "Pasted text",
    );
    expect(
      resolveDeskName({
        cardSummary: "Card",
        firstMessage: "Pasted text",
        registryName: "My name",
      }),
    ).toBe("Card");
  });

  it("keeps an inner paste tag with another id inside its paste, so no typed words leak out of it", () => {
    const nested =
      '<pasted_content id="outer">start <pasted_content id="inner">x</pasted_content id="inner"> end</pasted_content id="outer">';
    expect(isPasteOnly(nested)).toBe(true);
    expect(firstRealMessage(`${nested} fix it`)).toBe("fix it");
  });

  it("takes the head from the first non-blank paste, including one holding an inner tag of another id", () => {
    const block = (id: string, body: string) =>
      `<pasted_content id="${id}">${body}</pasted_content id="${id}">`;
    // a blank first paste is skipped
    expect(
      pasteHeadOf(`${block("d1", "  \n ")}${block("d2", "real text")}`),
    ).toBe("real text");
    expect(pasteHeadOf(block("d1", "   "))).toBeUndefined();
    // an inner block closed at a different id stays inside the outer paste
    const nested = block(
      "outer",
      'start <pasted_content id="inner">x</pasted_content id="inner"> end',
    );
    expect(pasteHeadOf(nested)).toContain("end");
  });

  it("ranks the task name below a card and above the first message, the registry name and the paste placeholder", () => {
    const base = {
      taskName: "Task name",
      firstMessage: "First message",
      registryName: "Registry name",
    };
    expect(resolveDeskName({ ...base, cardTitle: "Card title" })).toBe(
      "Card title",
    );
    expect(resolveDeskName(base)).toBe("Task name");
    expect(resolveDeskName({ ...base, firstMessage: "Pasted text" })).toBe(
      "Task name",
    );
  });

  it("takes the request from the whole message with pasted text in order, keeping line breaks, and gives none for a command, shell input or an empty paste", () => {
    expect(requestOf("Fix  the cart\n\n\n\nthen deploy")).toBe(
      "Fix the cart\n\nthen deploy",
    );
    expect(requestOf("<pasted_content/> fix the cart")).toBe("fix the cart");
    expect(
      requestOf(
        '<pasted_content id="d1">/clear\nsecond</pasted_content id="d1">',
      ),
    ).toBe("/clear\nsecond");
    expect(
      requestOf(
        'Fix:\n<pasted_content id="d1">a\nb</pasted_content id="d1"> now',
      ),
    ).toBe("Fix:\na\nb now");
    expect(requestOf('<pasted_content id="d1">cut off')).toBe("cut off");
    expect(requestOf("<pasted_content/>")).toBeUndefined();
    expect(requestOf("/clear")).toBeUndefined();
    expect(requestOf("!ls")).toBeUndefined();
    expect(Array.from(requestOf("😀".repeat(2100)) ?? "")).toHaveLength(2000);
  });
});
