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
  isLaunchOf,
  readWindowRecord,
  removeWindowRecord,
  sweepLaunchFiles,
  writeHireFiles,
  writeWakeFile,
  writeWindowRecord,
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

describe("recording the window a launch script runs in", () => {
  it("writes the shell's terminal device to the tty file before claude takes over, for a hire and for a wake", () => {
    // Given a stand-in `tty` that prints a device, and a stand-in claude that copies the tty file as it finds it
    const root = mkdtempSync(join(tmpdir(), "launch-tty-test-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "tty"), "#!/bin/sh\necho /dev/ttys042\n", {
      mode: 0o755,
    });
    const claude = join(root, "fake-claude");
    writeFileSync(claude, '#!/bin/sh\ncat "$TTYFILE" > "$OUT"\n', {
      mode: 0o755,
    });
    const home = join(root, "home");
    mkdirSync(home);
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const ttyFile = join(home, ".claude-office", "launch", `${sessionId}.tty`);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TTYFILE: ttyFile,
      OUT: join(root, "out.txt"),
    };

    // When the hire script runs, then the wake script
    const hire = writeHireFiles({
      home,
      sessionId,
      folder: root,
      claudePath: claude,
      message: "hello",
    });
    execFileSync("/bin/zsh", [hire], { env });
    const afterHire = readFileSync(env.OUT, "utf8");
    rmSync(ttyFile);
    const wake = writeWakeFile({
      home,
      sessionId,
      folder: root,
      claudePath: claude,
    });
    execFileSync("/bin/zsh", [wake], { env });
    const afterWake = readFileSync(env.OUT, "utf8");

    // Then claude already found the device recorded both times
    expect(afterHire.trim()).toBe("/dev/ttys042");
    expect(afterWake.trim()).toBe("/dev/ttys042");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("recording claude's own process in a launch script", () => {
  it("writes the pid claude runs as and its start time to the pid file, for a hire and for a wake", () => {
    // Given a stand-in claude that writes its own pid
    const root = mkdtempSync(join(tmpdir(), "launch-pid-test-"));
    const claude = join(root, "fake-claude");
    writeFileSync(claude, '#!/bin/sh\necho $$ > "$OUT"\n', { mode: 0o755 });
    const home = join(root, "home");
    mkdirSync(home);
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const out = join(root, "pid.txt");
    const env = { ...process.env, OUT: out };
    const launch = { home, sessionId, folder: root, claudePath: claude };

    for (const write of [
      () => writeHireFiles({ ...launch, message: "hello" }),
      () => writeWakeFile(launch),
    ]) {
      // When the script runs
      execFileSync("/bin/zsh", [write()], { env });

      // Then the record holds claude's own pid and the start time `ps` prints for it
      const own = Number(readFileSync(out, "utf8"));
      const record = readWindowRecord(home, sessionId);
      expect(record.pid).toBe(own);
      expect(record.started).toMatch(
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/,
      );
      removeWindowRecord(home, sessionId);
    }
    rmSync(root, { recursive: true, force: true });
  });
});

describe("a launch's window record from an earlier launch of the same conversation", () => {
  it("is deleted when a hire or a wake writes its files, so the old device and window are never taken for the new window's", () => {
    // Given a record left by an earlier window of the same conversation
    const home = mkdtempSync(join(tmpdir(), "launch-test-"));
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const ttyFile = join(home, ".claude-office", "launch", `${sessionId}.tty`);
    const launch = { home, sessionId, folder: home, claudePath: "/bin/claude" };
    const leaveOldRecord = () => {
      mkdirSync(join(home, ".claude-office", "launch"), { recursive: true });
      writeFileSync(ttyFile, "/dev/ttys001\n");
      writeFileSync(
        join(home, ".claude-office", "launch", `${sessionId}.pid`),
        "4242 Mon Nov  6 08:00:00 2026\n",
      );
      writeWindowRecord(home, sessionId, 4242);
    };

    for (const write of [
      () => writeHireFiles({ ...launch, message: "hi" }),
      () => writeWakeFile(launch),
    ]) {
      leaveOldRecord();

      // When the next launch's files are written
      write();

      // Then no device and no window id remain on record
      expect(readWindowRecord(home, sessionId)).toEqual({});
    }
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
    rmSync(root, { recursive: true, force: true });
  });
});

describe("recognising the claude command a hire or wake started", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const claude = "/opt/homebrew/bin/claude";

  it("matches --session-id and --resume before the first --, and nothing a message or another program could spell", () => {
    // Then a hire's and a wake's command lines match
    expect(
      isLaunchOf(
        `${claude} --remote-control --session-id ${id} -- hello`,
        id,
        claude,
      ),
    ).toBe(true);
    expect(
      isLaunchOf(`${claude} --resume ${id} --remote-control`, id, claude),
    ).toBe(true);

    // And the first message after -- can never name the session
    expect(
      isLaunchOf(
        `${claude} --remote-control -- --session-id ${id}`,
        id,
        claude,
      ),
    ).toBe(false);

    // And another session, another program, or another binary that only starts with the path never matches
    expect(isLaunchOf(`${claude} --resume ${id}x`, id, claude)).toBe(false);
    expect(isLaunchOf(`/usr/bin/vim --resume ${id}`, id, claude)).toBe(false);
    expect(isLaunchOf(`${claude}-other --resume ${id}`, id, claude)).toBe(
      false,
    );
  });
});

describe("sweeping the launch folder at start-up", () => {
  it("deletes scripts and messages but keeps the window records of a kept desk, which a restarted agent still needs to close its window", () => {
    // Given the launch files of one hire, including its window records
    const home = mkdtempSync(join(tmpdir(), "launch-sweep-test-"));
    const sessionId = "11111111-2222-3333-4444-555555555555";
    writeHireFiles({
      home,
      sessionId,
      folder: home,
      claudePath: "/bin/true",
      message: "hello",
    });
    writeWindowRecord(home, sessionId, 7001);
    const dir = join(home, ".claude-office", "launch");
    writeFileSync(join(dir, `${sessionId}.tty`), "/dev/ttys003\n");

    // When the agent starts and sweeps
    sweepLaunchFiles(home, (id) => id === sessionId);

    // Then the script and message are gone and the window can still be read back
    expect(existsSync(join(dir, `${sessionId}.command`))).toBe(false);
    expect(existsSync(join(dir, `${sessionId}.msg`))).toBe(false);
    expect(readWindowRecord(home, sessionId)).toEqual({
      tty: "/dev/ttys003",
      windowId: 7001,
    });
    rmSync(home, { recursive: true, force: true });
  });
});
