import { spawn } from "node:child_process";
import { join } from "node:path";

const HOOK_PATH = join(process.cwd(), "hooks", "claude-office-hook.mjs");

/** How long a hook may run before the harness kills the child it started and reports a hang. */
const HANG_LIMIT_MS = 5000;

export interface HookResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  wallMs: number;
}

export interface RunningHook {
  /** Sends stdin (left open when started with `holdStdin`) and resolves when the process closes. */
  finish(): Promise<HookResult>;
}

/**
 * Starts the real hook script as Claude Code would: JSON on stdin, `HOME` pointing at a fake home.
 * @param home - The fake home folder.
 * @param payload - An event object, or a raw string for malformed input.
 * @param env - Extra environment variables.
 * @returns A handle whose `finish()` closes stdin and waits for the process.
 */
export function startHook(
  home: string,
  payload: object | string,
  env: Record<string, string> = {},
  { holdStdin = false }: { holdStdin?: boolean } = {},
): RunningHook {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [HOOK_PATH], {
    env: { ...process.env, HOME: home, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  // Resolve on "close", not "exit": Claude Code reads the pipes to EOF, so a held pipe is a hang.
  let timedOut = false;
  const closed = new Promise<HookResult>((resolve) => {
    // Kills only the child started here, so a hung hook cannot outlive the test.
    const limit = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, HANG_LIMIT_MS);
    child.on("close", (code) => {
      clearTimeout(limit);
      resolve({
        code,
        timedOut,
        stdout,
        stderr,
        wallMs: Date.now() - startedAt,
      });
    });
  });
  child.stdin.on("error", () => {});
  return {
    finish() {
      if (holdStdin) return closed;
      child.stdin.end(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      );
      return closed;
    },
  };
}

/**
 * Runs the hook to completion for one event.
 * @param home - The fake home folder.
 * @param payload - An event object, or a raw string.
 * @returns Exit code, output and wall time.
 */
export function runHook(
  home: string,
  payload: object | string,
  env: Record<string, string> = {},
  options: { holdStdin?: boolean } = {},
): Promise<HookResult> {
  return startHook(home, payload, env, options).finish();
}

/** Lets a hook that was started earlier finish booting, so its `hookTs` is older than the next one's. */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
