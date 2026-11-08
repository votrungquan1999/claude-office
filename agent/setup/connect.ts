import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONNECT_CODE_TTL_MS,
  collectConnectResponseSchema,
  createConnectResponseSchema,
  formatUserCode,
} from "../../src/shared/connect";
import { officeDir, readValidConfig, writeFileAtomic } from "../config";

export interface ConnectOptions {
  home: string;
  /** The office's address, without a trailing slash. */
  appUrl: string;
  /** The Mac's computer name, shown to the owner on the approval page. */
  computerName: string;
  /** Opens a link in the owner's browser; may fail on a Mac with no desktop. */
  openUrl: (url: string) => Promise<void>;
  print: (line: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  /** Ask for a new approval even when a valid connection is saved. */
  reconnect?: boolean;
}

const DEFAULT_POLL_MS = 2500;

/**
 * Saves the connection where only this user can read it; temp then rename so the agent never
 * reads half a file; the folder is chmodded because mkdir leaves an existing folder's mode as it was.
 * @param home - The user's home folder.
 * @param config - The connection to save.
 */
function saveConfig(
  home: string,
  config: { mongodbUri: string; mongodbDb: string },
): void {
  const dir = officeDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  // A reconnect replaces the connection only; the owner's key stays.
  const anthropicApiKey = readValidConfig(home)?.anthropicApiKey;
  writeFileAtomic(
    join(dir, "config.json"),
    JSON.stringify({
      ...config,
      ...(anthropicApiKey ? { anthropicApiKey } : {}),
    }),
    0o600,
  );
}

/**
 * Connects this Mac to the office database through the owner's one click in the browser.
 * @param options - Where to connect and what to inject.
 */
export async function connectMac(options: ConnectOptions): Promise<void> {
  if (!options.reconnect && readValidConfig(options.home)) {
    options.print(
      "Already connected; keeping the saved connection. Run setup with --reconnect to approve a new one.",
    );
    return;
  }
  const doFetch = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const post = (path: string, body: unknown) =>
    doFetch(`${options.appUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const created = await post("/api/connect", {
    hostname: options.computerName,
  });
  if (!created.ok) {
    throw new Error(
      created.status === 429
        ? "Too many connect requests are open; wait a few minutes and run setup again."
        : `The office refused the connect request (${created.status}).`,
    );
  }
  const { userCode, pollSecret, connectUrl } =
    createConnectResponseSchema.parse(await created.json());
  const deadline = now() + CONNECT_CODE_TTL_MS;

  // Printed in full so it works when the browser is on another device or over SSH.
  options.print(`Open this link while signed in as the owner: ${connectUrl}`);
  options.print(
    `Check the page shows code ${formatUserCode(userCode)}, then click "Connect this Mac".`,
  );
  try {
    await options.openUrl(connectUrl);
  } catch {
    options.print("Could not open a browser here; open the link yourself.");
  }

  for (;;) {
    if (now() >= deadline) {
      throw new Error(
        "The code expired before it was approved; run setup again.",
      );
    }
    const polled = await post("/api/connect/collect", { pollSecret });
    if (polled.status === 202) {
      await sleep(options.pollMs ?? DEFAULT_POLL_MS);
      continue;
    }
    if (!polled.ok) {
      throw new Error("The code expired or was refused; run setup again.");
    }
    saveConfig(
      options.home,
      collectConnectResponseSchema.parse(await polled.json()),
    );
    options.print("Connected. The connection is saved in ~/.claude-office/.");
    return;
  }
}
