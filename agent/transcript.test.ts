import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTranscriptSeed } from "./transcript";

describe("the transcript seed", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("takes the first message and the request of a Claude in Chrome session from the typed block, not the browser instructions", () => {
    // Given a first record shaped like Claude in Chrome writes it: a long instruction block, then the typed words
    home = mkdtempSync(join(tmpdir(), "office-transcript-"));
    const folder = join(home, ".claude", "projects", "-work-a");
    mkdirSync(folder, { recursive: true });
    const browser = `<browser_instruction># Claude in Chrome browser automation\n\n${"b".repeat(4080)}</browser_instruction>`;
    const typed =
      "i want a convenient way to write things down, actual hand writing, so it clears my mind";
    const record = {
      type: "user",
      isSidechain: false,
      origin: { kind: "human" },
      cwd: "/work/a",
      message: {
        role: "user",
        content: [
          { type: "text", text: browser },
          { type: "text", text: typed },
        ],
      },
    };
    writeFileSync(join(folder, "chrome.jsonl"), `${JSON.stringify(record)}\n`);

    // When the seed is read
    const seed = readTranscriptSeed(home, "chrome");

    // Then both come from the typed words
    expect(seed.firstMessage).toBe(
      "i want a convenient way to write things down, actual hand w…",
    );
    expect(seed.request).toBe(typed);
  });
});
