import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { afterEach } from "vitest";

export interface ProcessInfo {
  pid: number;
  /** Same text Claude Code records as `procStart`. */
  procStart: string;
}

/** `ps -o lstart` text for a pid, in UTC like Claude Code records it. */
export function startTimeOf(pid: number): string {
  return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  }).trim();
}

/**
 * Starts throwaway child processes standing in for Claude sessions; only these children are ever killed.
 * @returns Helpers to start a live one, make a dead one, and clean up.
 */
export function useLiveProcesses() {
  const children: ChildProcess[] = [];

  function start(args: string[]): ChildProcess {
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    children.push(child);
    return child;
  }

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  /** A process that stays alive until the test ends; `args` replaces its command line after the binary. */
  async function live(
    args: string[] = ["-e", "setInterval(() => {}, 1e6)"],
  ): Promise<ProcessInfo & { kill(): Promise<void> }> {
    const child = start(args);
    await new Promise((resolve) => child.once("spawn", resolve));
    const pid = child.pid ?? 0;
    return {
      pid,
      procStart: startTimeOf(pid),
      async kill() {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGKILL");
        await exited;
      },
    };
  }

  /** A process that has already exited, so its pid is free. */
  async function dead(): Promise<ProcessInfo> {
    const stopped = await live();
    await stopped.kill();
    return { pid: stopped.pid, procStart: stopped.procStart };
  }

  return { live, dead };
}
