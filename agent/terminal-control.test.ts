import { describe, expect, it, vi } from "vitest";
import {
  CloseOutcome,
  createOsascriptControl,
  TerminalControlError,
  TerminalFailure,
} from "./terminal-control";

/** A runner that answers each script in turn and records what it was asked; no real osascript ever runs. */
function scripted(...answers: Array<string | Error>) {
  const scripts: string[] = [];
  const run = vi.fn(async (script: string) => {
    scripts.push(script);
    const answer = answers.shift() ?? "";
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { run, scripts };
}

describe("finding a Terminal window by its terminal device", () => {
  it("asks about no window for a process without a terminal, names the device in full otherwise, and reads the window id back", async () => {
    // Given a Terminal that answers with a window id and its device
    const { run, scripts } = scripted("7001 /dev/ttys003");
    const control = createOsascriptControl(run);

    // When the process has no terminal
    // Then no script runs and there is no window
    expect(await control.findWindow({ pid: 1, tty: "??" })).toBeUndefined();
    expect(run).not.toHaveBeenCalled();

    // When the device is the short form `ps` prints
    const window = await control.findWindow({ pid: 1, tty: "ttys003" });

    // Then the script names it in full and the answer becomes the window
    expect(scripts[0]).toContain('"/dev/ttys003"');
    expect(window).toEqual({ id: 7001, tty: "/dev/ttys003" });
  });

  it("finds no window when Terminal is not running or no tab has the device, without starting Terminal", async () => {
    // Given scripts that answer nothing
    const { run, scripts } = scripted("", "");
    const control = createOsascriptControl(run);

    // When it looks
    const missing = await control.findWindow({ tty: "/dev/ttys009" });

    // Then there is no window, and the script checks Terminal is running before it talks to it
    expect(missing).toBeUndefined();
    expect(scripts[0]).toContain('application "Terminal" is not running');
    expect(scripts[0].indexOf("is not running")).toBeLessThan(
      scripts[0].indexOf("tell application"),
    );
  });
});

describe("Terminal that cannot be driven", () => {
  it("is not permitted when macOS refuses the agent (-1743) and timed out when the script is killed by the limit", async () => {
    // Given a refusal and a timeout from the runner
    const refused = Object.assign(
      new Error(
        "execution error: Not authorized to send Apple events to Terminal. (-1743)",
      ),
      {},
    );
    const timedOut = Object.assign(new Error("Command failed"), {
      killed: true,
    });

    // When each call fails
    const first = createOsascriptControl(scripted(refused).run);
    const second = createOsascriptControl(scripted(timedOut, timedOut).run);

    // Then each is a Terminal control error with its own reason
    await expect(
      first.isBusy({ id: 1, tty: "/dev/ttys001" }),
    ).rejects.toMatchObject({
      failure: TerminalFailure.NotPermitted,
    });
    await expect(
      second.isBusy({ id: 1, tty: "/dev/ttys001" }),
    ).rejects.toBeInstanceOf(TerminalControlError);
    await expect(
      second.isBusy({ id: 1, tty: "/dev/ttys001" }),
    ).rejects.toMatchObject({
      failure: TerminalFailure.TimedOut,
    });
  });
});

describe("Terminal failing in a way that is neither a refusal nor a timeout", () => {
  it("is a Terminal control error with a generic reason, so a dismiss can end with a note instead of failing", async () => {
    // Given a script that fails for any other reason, such as an AppleScript error
    const broken = new Error(
      "execution error: Terminal got an error. (-10000)",
    );

    // When each call fails
    const control = createOsascriptControl(
      scripted(broken, broken, broken).run,
    );
    const window = { id: 1, tty: "/dev/ttys001" };

    // Then every one is a Terminal control error
    for (const call of [
      () => control.findWindow({ tty: "ttys001" }),
      () => control.isBusy(window),
      () => control.close(window),
    ]) {
      await expect(call()).rejects.toMatchObject({
        failure: TerminalFailure.Failed,
      });
    }
  });
});

describe("whether a tab is busy", () => {
  it("reads true and false from Terminal, and is not busy when the window or Terminal is gone", async () => {
    const control = createOsascriptControl(scripted("true", "false", "").run);
    const window = { id: 7001, tty: "/dev/ttys003" };
    expect(await control.isBusy(window)).toBe(true);
    expect(await control.isBusy(window)).toBe(false);
    expect(await control.isBusy(window)).toBe(false);
  });
});

describe("closing the conversation's tab", () => {
  const window = { id: 7001, tty: "/dev/ttys003" };

  it("closes the window by id when the conversation's tab is its only tab", async () => {
    // Given a window with one tab on the device
    const { run, scripts } = scripted("1 /dev/ttys003", "");

    // When it is closed
    const outcome = await createOsascriptControl(run).close(window);

    // Then the window itself was closed
    expect(outcome).toBe(CloseOutcome.Closed);
    expect(scripts[1]).toContain("close window id 7001");
  });

  it("closes nothing when the window has other tabs, and says so", async () => {
    // Given a window with three tabs
    const { run, scripts } = scripted("3 /dev/ttys003", "");

    // When it is closed
    const outcome = await createOsascriptControl(run).close(window);

    // Then no close script ran
    expect(outcome).toBe(CloseOutcome.OtherTabs);
    expect(scripts).toHaveLength(1);
  });

  it("closes nothing when the window is gone or its tab no longer has the device", async () => {
    // Given a window that no longer exists, then one whose tab was reused by another device
    const gone = scripted("");
    const reused = scripted("2 /dev/ttys777");

    // When each is closed
    // Then neither close script ran
    expect(await createOsascriptControl(gone.run).close(window)).toBe(
      CloseOutcome.Missing,
    );
    expect(gone.scripts).toHaveLength(1);
    expect(await createOsascriptControl(reused.run).close(window)).toBe(
      CloseOutcome.Missing,
    );
    expect(reused.scripts).toHaveLength(1);
  });
});
