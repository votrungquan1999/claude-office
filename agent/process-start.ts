import { execFileSync } from "node:child_process";

/**
 * When a process started, as `ps -o lstart` prints it in the C locale in UTC with spaces collapsed.
 * A pid alone does not identify a process because pids get reused; the pair pid + start time does.
 * @param pid - The process to look up.
 * @returns The start time, or undefined when `ps` cannot say (no such process, or `ps` unavailable).
 */
export function readProcessStart(pid: number): string | undefined {
  try {
    const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    return text.replace(/\s+/g, " ").trim() || undefined;
  } catch {
    return undefined;
  }
}
