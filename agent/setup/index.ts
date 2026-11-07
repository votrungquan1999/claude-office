import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import { readComputerName } from "../computer-name";
import { connectMac } from "./connect";

const run = promisify(execFile);

const DEFAULT_APP_URL = "https://office.quanvo.dev";

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
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
