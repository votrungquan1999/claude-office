import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useTestMongo } from "@/test/use-test-mongo";
import { makeFakeHome } from "../test/fake-home";
import { installLaunchAgent } from "./install-launchd";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const START_LIMIT_MS = 30_000;

async function waitFor(
  check: () => boolean,
  what: string,
  output: () => string,
) {
  const deadline = Date.now() + START_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`${what} never happened:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(process.platform !== "darwin")(
  "starting the agent the way the login job does",
  () => {
    useTestMongo();

    it("starts from the plist's own command and working folder under launchd's bare PATH, and stops cleanly", async () => {
      // Given a fake Mac with a connection saved and the repo link in place
      const fake = makeFakeHome("m-login");
      symlinkSync(REPO_ROOT, join(fake.home, ".claude", "claude-office"));
      mkdirSync(join(fake.home, ".claude-office"), { recursive: true });
      writeFileSync(
        join(fake.home, ".claude-office", "config.json"),
        JSON.stringify({
          mongodbUri: process.env.MONGODB_URI,
          mongodbDb: process.env.MONGODB_DB,
        }),
      );
      let loaded = false;
      const { plistPath } = await installLaunchAgent({
        home: fake.home,
        repoRoot: REPO_ROOT,
        uid: 501,
        launchctl: async (args) => {
          if (args[0] === "bootstrap") loaded = true;
          const missing =
            args[0] === "print" && args[1] !== "gui/501" && !loaded;
          return { code: missing ? 113 : 0, stdout: "", stderr: "" };
        },
        sleep: async () => {},
      });
      const plist = JSON.parse(
        execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
          encoding: "utf8",
        }),
      );
      const [command, ...args] = plist.ProgramArguments as string[];

      // When that exact command runs in that folder with only the system PATH
      let output = "";
      const child = spawn(command, args, {
        cwd: plist.WorkingDirectory,
        env: { HOME: fake.home, PATH: "/usr/bin:/bin", NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const exited = new Promise<number | null>((resolve) =>
        child.once("exit", resolve),
      );
      try {
        // Then it comes up and publishes its address
        const agentFile = join(fake.home, ".claude-office", "agent.json");
        await waitFor(
          () => existsSync(agentFile),
          "the agent starting",
          () => output,
        );

        // And a stop signal ends it and removes the address
        child.kill("SIGTERM");
        expect(await exited).toBe(0);
        expect(existsSync(agentFile)).toBe(false);
      } finally {
        // Only the process this test started.
        if (child.exitCode === null) child.kill("SIGKILL");
        fake.remove();
      }
    });
  },
);
