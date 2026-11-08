import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  mongodbUri: z.string().min(1),
  mongodbDb: z.string().min(1),
  /** The owner's optional Anthropic key for naming paste-only desks; blank counts as absent. */
  anthropicApiKey: z
    .string()
    .optional()
    .transform((key) => key?.trim() || undefined),
});

export type AgentConfig = z.infer<typeof configSchema>;

const agentFileSchema = z.object({
  pid: z.number(),
  port: z.number(),
  token: z.string(),
  /** Start time of the agent's process; absent in files from agents that did not record it. */
  procStart: z.string().optional(),
});

export type AgentFile = z.infer<typeof agentFileSchema>;

const claudeJsonSchema = z.object({ machineID: z.string().min(1) });

/** The office's own folder under the user's home. */
export function officeDir(home: string): string {
  return join(home, ".claude-office");
}

/**
 * Reads the connection settings the setup command saved.
 * @param home - The user's home folder.
 * @returns The settings, or undefined while setup has not run.
 */
export function readConfig(home: string): AgentConfig | undefined {
  const file = join(officeDir(home), "config.json");
  if (!existsSync(file)) return undefined;
  return configSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Reads the saved connection without throwing.
 * @param home - The user's home folder.
 * @returns The settings, or undefined when the file is missing, unreadable or malformed.
 */
export function readValidConfig(home: string): AgentConfig | undefined {
  try {
    return readConfig(home);
  } catch {
    return undefined;
  }
}

/**
 * Reads this Mac's id from `~/.claude.json` (a large file, so read once at start).
 * @param home - The user's home folder.
 * @returns The machine id.
 */
export function readMachineId(home: string): string {
  const raw = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
  return claudeJsonSchema.parse(raw).machineID;
}

/**
 * Reads the address a previous agent left behind.
 * @param home - The user's home folder.
 * @returns The address, or undefined when there is none or it is unreadable.
 */
export function readAgentFile(home: string): AgentFile | undefined {
  try {
    const parsed = agentFileSchema.safeParse(
      JSON.parse(readFileSync(join(officeDir(home), "agent.json"), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes a file whole or not at all: temp then rename, so a reader never sees half a file.
 * @param target - The file to write.
 * @param text - Its contents.
 * @param mode - Its permission bits, applied with chmod since the umask can strip or loosen the create mode.
 */
export function writeFileAtomic(
  target: string,
  text: string,
  mode: number,
): void {
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, target);
}

/**
 * Publishes the agent's address for the hook, which must never read half a file.
 * @param home - The user's home folder.
 * @param agent - The address.
 */
export function writeAgentFile(home: string, agent: AgentFile): void {
  const dir = officeDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileAtomic(join(dir, "agent.json"), JSON.stringify(agent), 0o600);
}
