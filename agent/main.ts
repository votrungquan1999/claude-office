import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentConfig, officeDir, readConfig } from "./config";
import { capLogFile } from "./log-cap";
import { type RunningAgent, startAgent } from "./start-agent";

const CONFIG_POLL_MS = 5000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Reads the saved connection; a file that cannot be parsed ends the agent with one clear line, not a crash loop. */
function readConfigOrExit(home: string): AgentConfig | undefined {
  try {
    return readConfig(home);
  } catch {
    console.error(
      "claude-office agent: ~/.claude-office/config.json is unreadable or incomplete; run npm run setup -- --reconnect",
    );
    process.exit(1);
  }
}

/** Runs the agent for this user until it is stopped; the login job starts it. */
async function main(): Promise<void> {
  const home = homedir();
  capLogFile(join(officeDir(home), "logs", "agent.log"), MAX_LOG_BYTES);
  let announced = false;
  let config = readConfigOrExit(home);
  while (!config) {
    // Idle until setup has saved the connection, with one log line instead of a crash loop.
    if (!announced) {
      console.error(
        "claude-office agent: waiting for ~/.claude-office/config.json (run npm run setup)",
      );
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG_POLL_MS));
    config = readConfigOrExit(home);
  }

  let agent: RunningAgent;
  try {
    agent = await startAgent({
      home,
      mongo: { uri: config.mongodbUri, db: config.mongodbDb },
    });
  } catch (error) {
    // The connection string is never logged.
    const reason =
      error instanceof Error &&
      error.name === "MongoServerError" &&
      "codeName" in error &&
      error.codeName === "AuthenticationFailed"
        ? "the database refused the saved login; re-run npm run setup -- --reconnect"
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(`claude-office agent: could not start: ${reason}`);
    process.exit(1);
  }

  const stop = () => {
    void agent.stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void main();
