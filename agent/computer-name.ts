import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Reads a command's output; injected so tests never call the real `scutil`. */
export type RunCommand = (
  file: string,
  args: string[],
) => Promise<{ stdout: string }>;

/**
 * The Mac's name as System Settings shows it, which labels its employees and its connect request.
 * @param runCommand - Runs `scutil`; defaults to the real one.
 * @returns The computer name.
 */
export async function readComputerName(
  runCommand: RunCommand = run,
): Promise<string> {
  try {
    const { stdout } = await runCommand("scutil", ["--get", "ComputerName"]);
    if (stdout.trim()) return stdout.trim();
  } catch {
    // No scutil off macOS; the short host name is the fallback.
  }
  return hostname().split(".")[0];
}
