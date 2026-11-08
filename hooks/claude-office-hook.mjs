#!/usr/bin/env node
// Forwards a reduced copy of each Claude Code hook event to the local office agent. Plain JS, no
// dependencies, so node starts fast; it cannot import the TypeScript allowlist in src/shared.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUEST_TIMEOUT_MS = 1000;
const PROMPT_MAX = 500;
const HARD_EXIT_MS = 1500;

const STRING_FIELDS = [
  "hook_event_name",
  "session_id",
  "cwd",
  "tool_name",
  "tool_use_id",
  "notification_type",
  "source",
  "agent_id",
  "agent_type",
  "session_title",
];

/**
 * Keeps only what step text needs from a tool's input; command text, file contents and the like are dropped.
 * @param {string | undefined} toolName
 * @param {unknown} input
 * @returns {Record<string, string | boolean> | undefined}
 */
function reduceToolInput(toolName, input) {
  if (!input || typeof input !== "object") return undefined;
  const text = (value) => (typeof value === "string" ? value : undefined);
  let reduced;
  switch (toolName) {
    case "Bash":
    case "Agent":
      reduced = {
        description: text(input.description),
        run_in_background: input.run_in_background === true ? true : undefined,
      };
      break;
    case "Read":
    case "Edit":
    case "Write":
      reduced = {
        file_name: text(input.file_path) && path.basename(input.file_path),
      };
      break;
    case "Grep":
    case "Glob":
      reduced = { pattern: text(input.pattern) };
      break;
    case "WebSearch":
      reduced = { query: text(input.query) };
      break;
    case "WebFetch":
      reduced = {
        domain:
          text(input.url) && URL.canParse(input.url)
            ? new URL(input.url).hostname
            : undefined,
      };
      break;
    case "TodoWrite": {
      const active = Array.isArray(input.todos)
        ? input.todos.find((todo) => todo?.status === "in_progress")
        : undefined;
      reduced = { activeTodo: text(active?.activeForm) };
      break;
    }
    default:
      return undefined;
  }
  const kept = Object.fromEntries(
    Object.entries(reduced).filter(([, value]) => value !== undefined),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Reduces a raw hook payload to the allowlisted fields the agent accepts.
 * @param {Record<string, unknown>} data - The JSON Claude Code sent on stdin.
 * @param {number} hookTs - When this hook process started.
 * @param {Record<string, string | undefined>} env - The process environment.
 * @returns {Record<string, unknown>}
 */
export function reduceEvent(data, hookTs, env) {
  const event = { hookTs };
  for (const field of STRING_FIELDS) {
    if (typeof data[field] === "string") event[field] = data[field];
  }
  // Only SessionEnd's reason is a fixed vocabulary; other events may carry free text.
  if (data.hook_event_name === "SessionEnd" && typeof data.reason === "string")
    event.reason = data.reason;
  if (typeof data.duration_ms === "number")
    event.duration_ms = data.duration_ms;
  if (typeof data.is_interrupt === "boolean")
    event.is_interrupt = data.is_interrupt;
  if (typeof data.prompt === "string")
    event.prompt = data.prompt.slice(0, PROMPT_MAX);
  const bridge = env.CLAUDE_CODE_BRIDGE_SESSION_ID;
  if (bridge) event.bridgeSessionId = bridge;
  const toolInput = reduceToolInput(data.tool_name, data.tool_input);
  if (toolInput) event.tool_input = toolInput;
  return event;
}

/** `ps -o lstart` of a pid in the C locale in UTC with spaces collapsed; undefined when ps cannot say. */
function startOf(pid) {
  try {
    const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
    return text.replace(/\s+/g, " ").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The agent's address, or undefined when it is not running. */
function readAgent() {
  const file = path.join(os.homedir(), ".claude-office", "agent.json");
  const agent = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof agent?.pid !== "number" ||
    typeof agent?.port !== "number" ||
    typeof agent?.token !== "string"
  ) {
    return undefined;
  }
  try {
    process.kill(agent.pid, 0);
  } catch {
    return undefined;
  }
  // A reused pid must not receive the bearer token and the prompt text.
  if (typeof agent.procStart === "string") {
    const current = startOf(agent.pid);
    if (current !== undefined && current !== agent.procStart) return undefined;
  }
  return agent;
}

function post(agent, body) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: agent.port,
        path: "/events",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${agent.token}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      },
    );
    request.on("error", resolve);
    request.on("timeout", () => request.destroy());
    request.end(body);
  });
}

async function main() {
  // Stamped first: async hooks run as separate processes, so the agent orders events by this.
  const hookTs = Date.now();
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const agent = readAgent();
  if (!agent) return;
  await post(
    agent,
    JSON.stringify(reduceEvent(JSON.parse(input), hookTs, process.env)),
  );
}

// Only run when started as the hook, not when a test imports the reducer.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Claude Code enforces no timeout on async hooks; a ref'd timer ends a hung stdin or agent fast.
  setTimeout(() => process.exit(0), HARD_EXIT_MS);
  // Real error boundary: whatever fails, the session must see exit 0 and no output.
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
