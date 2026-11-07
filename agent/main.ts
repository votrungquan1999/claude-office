import { homedir } from "node:os";
import { readConfig } from "./config";
import { type RunningAgent, startAgent } from "./start-agent";

const CONFIG_POLL_MS = 5000;

/** Runs the agent for this user until it is stopped; the login job starts it. */
async function main(): Promise<void> {
  const home = homedir();
  let announced = false;
  let config = readConfig(home);
  while (!config) {
    // Idle until setup has saved the connection, with one log line instead of a crash loop.
    if (!announced) {
      console.error(
        "claude-office agent: waiting for ~/.claude-office/config.json (run npm run setup)",
      );
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG_POLL_MS));
    config = readConfig(home);
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
        ? "the database refused the saved login; re-run npm run setup"
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
