import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { firstRealMessage } from "../src/shared/desk-name";

/** Transcripts reach hundreds of MB, so only their two ends are ever read. */
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;

// Only the fields the agent uses; records carry many more, and tool input is never among them.
const recordSchema = z.object({
  type: z.string().optional(),
  cwd: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  origin: z.unknown().optional(),
  bridgeSessionId: z.string().optional(),
  message: z
    .object({
      content: z
        .union([
          z.string(),
          z.array(z.object({ type: z.string(), text: z.string().optional() })),
        ])
        .optional(),
    })
    .optional(),
});

type TranscriptRecord = z.infer<typeof recordSchema>;

export interface TranscriptSeed {
  /** The owner's first real message, cut short for a desk name. */
  firstMessage?: string;
  /** Whether the owner ever typed something into the session. */
  hadPrompt: boolean;
  /** The folder of the newest record. */
  cwd?: string;
  bridgeSessionId?: string;
}

/**
 * Reads a byte range and returns its complete lines.
 * @param path - The file.
 * @param tail - True for the last bytes, false for the first.
 * @returns The parsed records of the range; a line cut by the range is dropped.
 */
function readRecords(path: string, tail: boolean): TranscriptRecord[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, tail ? TAIL_BYTES : HEAD_BYTES);
    const start = tail ? size - length : 0;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    // The range may begin or end in the middle of a line.
    if (start > 0) lines.shift();
    if (start + length < size && !tail) lines.pop();
    const records: TranscriptRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const record = recordSchema.safeParse(raw);
      if (record.success) records.push(record.data);
    }
    return records;
  } finally {
    closeSync(fd);
  }
}

function transcriptPath(home: string, sessionId: string): string | undefined {
  const projects = join(home, ".claude", "projects");
  let folders: string[];
  try {
    folders = readdirSync(projects);
  } catch {
    return undefined;
  }
  // The folder name is a slug of the start folder, so the session id is searched instead of derived.
  for (const folder of folders) {
    const path = join(projects, folder, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The text blocks of a record sent by the owner; none for tool results, other agents and injected turns. */
function humanTexts(record: TranscriptRecord): string[] {
  if (record.type !== "user" || record.isSidechain) return [];
  // Skill bodies and compaction summaries are injected as user turns.
  if (record.isMeta || record.isCompactSummary) return [];
  const { origin } = record;
  if (
    typeof origin === "object" &&
    origin !== null &&
    "kind" in origin &&
    origin.kind !== "human"
  ) {
    return [];
  }
  const content = record.message?.content;
  if (typeof content === "string") return [content];
  return (content ?? []).flatMap((block) =>
    block.type === "text" && block.text !== undefined ? [block.text] : [],
  );
}

/**
 * What a session's transcript says about it, from bounded reads of its head and tail.
 * @param home - The user's home folder.
 * @param sessionId - The session.
 * @returns The seed; empty when there is no transcript or it cannot be read.
 */
export function readTranscriptSeed(
  home: string,
  sessionId: string,
): TranscriptSeed {
  const path = transcriptPath(home, sessionId);
  if (!path) return { hadPrompt: false };
  let head: TranscriptRecord[];
  let tail: TranscriptRecord[];
  try {
    head = readRecords(path, false);
    tail = readRecords(path, true);
  } catch {
    // Error boundary: an unreadable transcript only costs the desk name and folder hints, never the session.
    return { hadPrompt: false };
  }
  const prompts = head.flatMap(humanTexts);
  return {
    firstMessage: prompts
      .map((text) => firstRealMessage(text))
      .find((text) => text !== undefined),
    hadPrompt: tail.flatMap(humanTexts).length + prompts.length > 0,
    cwd: [...head, ...tail].findLast((record) => record.cwd)?.cwd,
    bridgeSessionId: [...head, ...tail].findLast(
      (record) => record.bridgeSessionId,
    )?.bridgeSessionId,
  };
}
