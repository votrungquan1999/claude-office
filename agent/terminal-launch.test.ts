import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHireScript,
  buildWakeScript,
  writeHireFiles,
} from "./terminal-launch";

describe("the script a hired window runs", () => {
  it("reaches the folder and passes the message untouched to claude, whatever the folder name or message holds", () => {
    // Given a folder whose name has a space and a quote, and a message with every awkward character
    const root = mkdtempSync(join(tmpdir(), "launch-test-"));
    const folder = join(root, "my app 'x'");
    mkdirSync(folder);
    const message = "--leading dash\nline two $HOME `id` \"quoted\" 'single'";
    const claude = join(root, "fake-claude");
    // A stand-in claude that writes its arguments one per line
    writeFileSync(claude, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$OUT"\n', {
      mode: 0o755,
    });
    const home = join(root, "home");
    mkdirSync(home);
    const script = writeHireFiles({
      home,
      sessionId: "11111111-2222-3333-4444-555555555555",
      folder,
      claudePath: claude,
      message,
    });

    // When the script runs
    const out = join(root, "out.txt");
    execFileSync("/bin/zsh", [script], { env: { ...process.env, OUT: out } });

    // Then claude ran in the folder with Remote Control, the session id and the exact message after `--`
    const lines = readFileSync(out, "utf8").split("\n");
    expect(lines.slice(1, 5)).toEqual([
      "--remote-control",
      "--session-id",
      "11111111-2222-3333-4444-555555555555",
      "--",
    ]);
    expect(lines.slice(5).join("\n").trimEnd()).toBe(message);
    expect(lines[0].endsWith("my app 'x'")).toBe(true);

    // And the script itself never contains the message
    expect(readFileSync(script, "utf8")).not.toContain("leading dash");
    expect(
      buildHireScript(
        { sessionId: "s", folder: "/a b", claudePath: "/c" },
        "/m",
      ),
    ).toContain("cd '/a b'");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the session id in a hired window's script and file names", () => {
  it("is quoted as one argument and nothing else runs when it is not a plain word", () => {
    // Given a hire script for an id with a semicolon, a comment mark and quotes, and a stand-in claude
    const root = mkdtempSync(join(tmpdir(), "launch-quote-test-"));
    const claude = join(root, "fake-claude");
    writeFileSync(claude, '#!/bin/sh\nprintf "%s\\n" "$@" > "$OUT"\n', {
      mode: 0o755,
    });
    const odd = "x; touch pwned #'y'";
    const script = join(root, "hire.command");
    writeFileSync(
      script,
      buildHireScript(
        { sessionId: odd, folder: root, claudePath: claude },
        join(root, "message"),
      ),
    );
    writeFileSync(join(root, "message"), "hello");

    // When the script runs
    const out = join(root, "out.txt");
    execFileSync("/bin/zsh", [script], { env: { ...process.env, OUT: out } });

    // Then claude got the id as one argument and the injected command never ran
    expect(readFileSync(out, "utf8").split("\n").slice(0, 3)).toEqual([
      "--remote-control",
      "--session-id",
      odd,
    ]);
    expect(existsSync(join(root, "pwned"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("is refused before any file is written when it is not a UUID", () => {
    // Given a home and ids that would name a file outside the launch folder or hold shell syntax
    const root = mkdtempSync(join(tmpdir(), "launch-name-test-"));
    for (const sessionId of ["../escape", "x; touch /tmp/pwn #", "plain"]) {
      // When the files of a hire for it are written
      const write = () =>
        writeHireFiles({
          home: root,
          sessionId,
          folder: root,
          claudePath: "/bin/true",
          message: "hello",
        });

      // Then it throws and the launch folder holds nothing
      expect(write).toThrow();
      expect(existsSync(join(root, ".claude-office", "launch"))).toBe(false);
      expect(existsSync(join(root, ".claude-office", "escape.command"))).toBe(
        false,
      );
    }
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the message file of a hired window", () => {
  it("is deleted by the script as soon as it has read the message, before claude starts", () => {
    // Given a hire whose stand-in claude reports whether the message file still exists when it starts
    const root = mkdtempSync(join(tmpdir(), "launch-rm-test-"));
    const claude = join(root, "fake-claude");
    writeFileSync(
      claude,
      '#!/bin/sh\n[ -e "$MSG" ] && echo present > "$OUT" || echo gone > "$OUT"\n',
      { mode: 0o755 },
    );
    const home = join(root, "home");
    mkdirSync(home);
    const script = writeHireFiles({
      home,
      sessionId: "11111111-2222-3333-4444-555555555556",
      folder: root,
      claudePath: claude,
      message: "secret plan",
    });
    const messageFile = script.replace(/\.command$/, ".msg");
    expect(existsSync(messageFile)).toBe(true);

    // When the script runs
    const out = join(root, "out.txt");
    execFileSync("/bin/zsh", [script], {
      env: { ...process.env, OUT: out, MSG: messageFile },
    });

    // Then the file was already gone when claude started
    expect(readFileSync(out, "utf8").trim()).toBe("gone");
    expect(existsSync(messageFile)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the script a woken window runs", () => {
  it("reaches the folder and resumes the conversation with Remote Control, whatever the folder name or session id holds", () => {
    // Given a folder with a space and a quote, and a session id that is not a plain word
    const root = mkdtempSync(join(tmpdir(), "wake-test-"));
    const folder = join(root, "my app 'x'");
    mkdirSync(folder);
    const claude = join(root, "fake-claude");
    writeFileSync(claude, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$OUT"\n', {
      mode: 0o755,
    });
    const home = join(root, "home");
    mkdirSync(home);
    const out = join(root, "out.txt");
    const run = (sessionId: string) => {
      const script = join(root, "wake.command");
      writeFileSync(
        script,
        buildWakeScript({ sessionId, folder, claudePath: claude }),
      );
      execFileSync("/bin/zsh", [script], { env: { ...process.env, OUT: out } });
      return readFileSync(out, "utf8").split("\n");
    };

    // When the script runs for a plain id and for one with a semicolon and a quote
    const plain = run("11111111-2222-3333-4444-555555555555");
    const odd = run("x; touch pwned 'y'");

    // Then claude ran in the folder with the id as one argument and `--remote-control`, and nothing else ran
    expect(plain.slice(1, 4)).toEqual([
      "--resume",
      "11111111-2222-3333-4444-555555555555",
      "--remote-control",
    ]);
    expect(plain[0].endsWith("my app 'x'")).toBe(true);
    expect(odd.slice(1, 4)).toEqual([
      "--resume",
      "x; touch pwned 'y'",
      "--remote-control",
    ]);
    expect(
      readFileSync(
        join(home, ".claude-office", "launch", "x; touch pwned 'y'.command"),
        "utf8",
      ),
    ).not.toContain("$msg");
    rmSync(root, { recursive: true, force: true });
  });
});
