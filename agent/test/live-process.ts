import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** What a stand-in conversation can be told to do. */
export interface StandInOptions {
  /** Put on the command line as `--session-id <id>` (or `--resume <id>` with `resume`), like a real claude's. */
  sessionId?: string;
  resume?: boolean;
  /** Children the stand-in spawns that ignore their stdin and outlive it (like a stdio MCP server that never exits). */
  children?: number;
  /** The stand-in survives SIGTERM, so only SIGKILL ends it. */
  ignoreTerm?: boolean;
}

/** A stand-in conversation: a parent process with children, all throwaway. */
export interface StandIn extends ProcessInfo {
  /** The pids of the children the stand-in spawned. */
  childPids(): number[];
  /** Ends the parent and its children at once; resolves at once when they are already gone. */
  kill(): Promise<void>;
}

/** The stand-in's program: spawns its children, records their pids in a file, then idles. */
const STAND_IN_SCRIPT = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [pidFile, count, ignoreTerm] = process.argv.slice(2);
if (ignoreTerm === "1") process.on("SIGTERM", () => {});
const pids = [];
for (let i = 0; i < Number(count); i++) {
  pids.push(spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], { stdio: "ignore" }).pid);
}
writeFileSync(pidFile, JSON.stringify(pids));
setInterval(() => {}, 1e6);
`;

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
  const standInDirs: string[] = [];
  const grandchildren: Array<() => number[]> = [];

  function start(args: string[]): ChildProcess {
    const child = spawn(process.execPath, args, { stdio: "ignore" });
    children.push(child);
    return child;
  }

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    // A stand-in's children are not our children, so they are killed by the pids it recorded.
    for (const pids of grandchildren.splice(0)) {
      for (const pid of pids()) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    for (const dir of standInDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
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
        // An already-exited child never fires `exit` again.
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGKILL");
        await exited;
      },
    };
  }

  /** A stand-in conversation: a parent with children that ignore stdin, started from a script file so its command line can carry `--session-id`. */
  async function standIn(options: StandInOptions = {}): Promise<StandIn> {
    const dir = mkdtempSync(join(tmpdir(), "claude-office-standin-"));
    standInDirs.push(dir);
    const script = join(dir, "stand-in.js");
    const pidFile = join(dir, "children.json");
    writeFileSync(script, STAND_IN_SCRIPT);
    const idArgs = options.sessionId
      ? [options.resume ? "--resume" : "--session-id", options.sessionId]
      : [];
    const child = start([
      script,
      pidFile,
      String(options.children ?? 0),
      options.ignoreTerm ? "1" : "0",
      // After the script's own arguments, like claude's options after its binary.
      ...idArgs,
    ]);
    await new Promise((resolve) => child.once("spawn", resolve));
    const childPids = (): number[] => {
      try {
        return JSON.parse(readFileSync(pidFile, "utf8")) as number[];
      } catch {
        return [];
      }
    };
    grandchildren.push(childPids);
    // The children exist once the script has written their pids.
    for (let tries = 0; tries < 200; tries++) {
      if (
        childPids().length === (options.children ?? 0) &&
        (options.children ?? 0) > 0
      )
        break;
      if ((options.children ?? 0) === 0 && tries > 5) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const pid = child.pid ?? 0;
    return {
      pid,
      procStart: startTimeOf(pid),
      childPids,
      async kill() {
        for (const grandchild of childPids()) {
          try {
            process.kill(grandchild, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
        if (child.exitCode !== null || child.signalCode !== null) return;
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

  return { live, dead, standIn };
}
