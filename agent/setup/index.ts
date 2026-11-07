import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { readComputerName } from "../computer-name";
import { connectMac } from "./connect";
import { installHooks } from "./install-hooks";
import { installLaunchAgent, type LaunchctlResult } from "./install-launchd";

const run = promisify(execFile);

const DEFAULT_APP_URL = "https://office.quanvo.dev";

/** Runs `launchctl` and reports its exit code instead of throwing, since a missing job is an ordinary answer. */
async function launchctl(args: string[]): Promise<LaunchctlResult> {
  try {
    const { stdout, stderr } = await run("launchctl", args);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? String(error),
    };
  }
}

/** Sets this Mac up for the office; each step is safe to run again. */
async function main(): Promise<void> {
  const appUrl = z
    .url()
    .parse(process.env.CLAUDE_OFFICE_URL ?? DEFAULT_APP_URL)
    .replace(/\/+$/, "");
  await connectMac({
    home: homedir(),
    appUrl,
    computerName: await readComputerName(),
    // No shell: the link is passed as one argument.
    openUrl: async (url) => {
      await run("open", [url]);
    },
    print: (line) => console.log(line),
    reconnect: process.argv.includes("--reconnect"),
  });
  // This file lives two folders below the checkout's root.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  installHooks({
    home: homedir(),
    repoRoot,
    print: (line) => console.log(line),
  });
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("The login job needs a macOS user id.");
  const job = await installLaunchAgent({
    home: homedir(),
    repoRoot,
    uid,
    launchctl,
    print: (line) => console.log(line),
  });
  console.log(`Login job: ${job.state}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
