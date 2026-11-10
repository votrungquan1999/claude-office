import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanLaunchFiles, KeptDesks } from "../kept";
import { writeHireFiles } from "../terminal-launch";
import { type FakeHome, makeFakeHome } from "./fake-home";

describe("deleting a kept window's launch files", () => {
  let fake: FakeHome | undefined;
  afterEach(() => {
    fake?.remove();
    fake = undefined;
  });

  it("deletes the script and message the window was launched with even after it switched to a new conversation", () => {
    // Given a hired window whose launch files are on disk
    fake = makeFakeHome("m-launch");
    const script = writeHireFiles({
      home: fake.home,
      sessionId: "11111111-2222-3333-4444-555555555557",
      folder: fake.home,
      claudePath: "/bin/true",
      message: "the first message",
    });
    const message = script.replace(/\.command$/, ".msg");
    const kept = new KeptDesks();
    kept.add({
      sessionId: "11111111-2222-3333-4444-555555555557",
      launchId: "11111111-2222-3333-4444-555555555557",
      folder: fake.home,
      kind: "hired",
      launchedAt: 0,
      filesPresent: true,
    });

    // When the window switches conversation (a quick /clear) and the new one registers
    kept.moveKept("11111111-2222-3333-4444-555555555557", "second");
    cleanLaunchFiles(kept, fake.home, new Set(["second"]));

    // Then both launch files are gone and nothing is left to clean
    expect(existsSync(script)).toBe(false);
    expect(existsSync(message)).toBe(false);
    expect(kept.withFiles()).toEqual([]);
  });
});
