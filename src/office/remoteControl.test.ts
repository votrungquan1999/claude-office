import { describe, expect, it } from "vitest";
import { remoteControlUrl } from "./remoteControl";

describe("Remote Control link", () => {
  it("points at the session's page on claude.ai, and gives no link for a missing or unsafe id", () => {
    expect(remoteControlUrl("session_01AbC")).toBe(
      "https://claude.ai/code/session_01AbC",
    );
    expect(remoteControlUrl("a b")).toBe("https://claude.ai/code/a%20b");
    for (const unsafe of [
      undefined,
      "",
      "   ",
      "a/b",
      "a?x=1",
      "a#top",
      "../x",
    ]) {
      expect(remoteControlUrl(unsafe), String(unsafe)).toBeNull();
    }
  });
});
