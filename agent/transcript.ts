import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { asks } from "../src/shared/asks";
import { firstRealMessage, pasteHeadOf } from "../src/shared/desk-name";

/** Transcripts reach hundreds of MB, so only their two ends are ever read. */
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;

// Only the fields the agent uses; of a tool call's input, only the file path is read.
const recordSchema = z.object({
  type: z.string().optional(),
  cwd: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  isApiErrorMessage: z.boolean().optional(),
  subtype: z.string().optional(),
  hasOutput: z.boolean().optional(),
  origin: z.unknown().optional(),
  bridgeSessionId: z.string().optional(),
  message: z
    .object({
      content: z
        .union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
              // Only the folders of file tools are read from a tool call; command text is never parsed.
              input: z
                .object({
                  file_path: z.string().optional(),
                  notebook_path: z.string().optional(),
                })
                .optional()
                .catch(undefined),
            }),
          ),
        ])
        .optional(),
    })
    .optional(),
});

type TranscriptRecord = z.infer<typeof recordSchema>;

export interface TranscriptSeed {
  /** The owner's first real message, cut short for a desk name. */
  firstMessage?: string;
  /** The start of the paste when the first message was only a paste. */
  pasteHead?: string;
  /** Whether the owner ever typed something into the session. */
  hadPrompt: boolean;
  /** The folder of the newest record. */
  cwd?: string;
  bridgeSessionId?: string;
  /** The newest turn ended by asking the owner something. */
  asked: boolean;
  /** Folders its tool calls and records worked in; kept only to find their repos. */
  stepDirs: string[];
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

/** Whether a record starts a turn: any user prompt, human or background-task, that is not a tool result or injected text. */
function startsTurn(record: TranscriptRecord): boolean {
  if (record.type !== "user" || record.isSidechain) return false;
  if (record.isMeta || record.isCompactSummary) return false;
  const content = record.message?.content;
  return !(
    Array.isArray(content) && content.some((b) => b.type === "tool_result")
  );
}

/** The text blocks of an assistant record, joined; empty when it has none or is an API error notice. */
function assistantText(record: TranscriptRecord): string {
  if (record.type !== "assistant" || record.isApiErrorMessage) return "";
  const content = record.message?.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .flatMap((block) =>
      block.type === "text" && block.text !== undefined ? [block.text] : [],
    )
    .join("\n");
}

/** Whether an assistant record runs a tool, which means the turn was still going. */
function runsTool(record: TranscriptRecord): boolean {
  const content = record.message?.content;
  return (
    record.type === "assistant" &&
    Array.isArray(content) &&
    content.some((block) => block.type === "tool_use")
  );
}

/**
 * Whether the newest ended turn asked the owner something, by the same rule and segments as the live Stop path.
 * @param tail - The records of the transcript's last bytes.
 * @returns True when any segment of the turn, split at each Stop-hook summary, ends in a question.
 */
function turnAsked(tail: TranscriptRecord[]): boolean {
  const records = tail.filter((record) => !record.isSidechain);
  // The turn starts at the last prompt, including a background-task notification
  const lastPrompt = records.findLastIndex(startsTurn);
  const turn = records.slice(lastPrompt + 1);
  const lastText = turn.findLastIndex((record) => assistantText(record) !== "");
  if (lastText < 0) return false;
  // A user record (tool result), a tool call or an API error after the last text means the turn did not end on it
  if (
    turn
      .slice(lastText + 1)
      .some(
        (record) =>
          record.type === "user" ||
          runsTool(record) ||
          record.isApiErrorMessage,
      )
  ) {
    return false;
  }
  // Each Stop hook that produced a follow-up leaves a summary; every segment's last answer counts
  const segments: TranscriptRecord[][] = [[]];
  for (const record of turn) {
    segments.at(-1)?.push(record);
    if (record.type === "system" && record.subtype === "stop_hook_summary")
      segments.push([]);
  }
  return segments.some((segment) => {
    const last = segment.findLast((record) => assistantText(record) !== "");
    return last ? asks(assistantText(last)) : false;
  });
}

/**
 * The distinct folders a session's records and file tool calls point at.
 * @param records - Records of the transcript's two ends.
 * @returns Record folders and the folders of tool-call file paths.
 */
function stepDirsOf(records: TranscriptRecord[]): string[] {
  const dirs = new Set<string>();
  for (const record of records) {
    if (record.cwd) dirs.add(record.cwd);
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const file = block.input?.file_path ?? block.input?.notebook_path;
      if (block.type === "tool_use" && file)
        dirs.add(dirname(resolve(record.cwd ?? "/", file)));
    }
  }
  return [...dirs];
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
  if (!path) return { hadPrompt: false, asked: false, stepDirs: [] };
  let head: TranscriptRecord[];
  let tail: TranscriptRecord[];
  try {
    head = readRecords(path, false);
    tail = readRecords(path, true);
  } catch {
    // Error boundary: an unreadable transcript only costs the desk name and folder hints, never the session.
    return { hadPrompt: false, asked: false, stepDirs: [] };
  }
  const prompts = head.flatMap(humanTexts);
  const firstPrompt = prompts.find(
    (text) => firstRealMessage(text) !== undefined,
  );
  return {
    asked: turnAsked(tail),
    stepDirs: stepDirsOf([...head, ...tail]),
    firstMessage: prompts
      .map((text) => firstRealMessage(text))
      .find((text) => text !== undefined),
    pasteHead: firstPrompt === undefined ? undefined : pasteHeadOf(firstPrompt),
    hadPrompt: tail.flatMap(humanTexts).length + prompts.length > 0,
    cwd: [...head, ...tail].findLast((record) => record.cwd)?.cwd,
    bridgeSessionId: [...head, ...tail].findLast(
      (record) => record.bridgeSessionId,
    )?.bridgeSessionId,
  };
}
