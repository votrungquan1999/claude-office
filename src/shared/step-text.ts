import type { HookEvent } from "./hook-events";

const MAX_CHARS = 120;

/** Cut by code points so an emoji is never split. */
function cut(text: string): string {
  const chars = [...text];
  return chars.length <= MAX_CHARS
    ? text
    : `${chars.slice(0, MAX_CHARS - 1).join("")}…`;
}

/** Notes that the tool call returned at once while the work goes on. */
function withBackground(text: string, input: HookEvent["tool_input"]): string {
  return input?.run_in_background ? `${text} (started in background)` : text;
}

/**
 * Plain-words text for one tool step. It only sees the hook's reduced input, so a shell command can never appear.
 * @param toolName - The tool's name.
 * @param input - The reduced tool input from the hook.
 * @returns The text shown in the steps list.
 */
export function stepText(
  toolName: string | undefined,
  input: HookEvent["tool_input"],
): string {
  const name = toolName || "Tool";
  const description = input?.description?.trim();
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
      return cut(input?.file_name ? `${name} ${input.file_name}` : name);
    case "Bash":
      return cut(withBackground(description || "Bash", input));
    case "Agent":
      return cut(
        withBackground(description ? `Agent: ${description}` : "Agent", input),
      );
    case "Grep":
    case "Glob":
      return cut(input?.pattern ? `Search '${input.pattern}'` : "Search");
    case "WebSearch":
      return cut(input?.query || name);
    case "WebFetch":
      return cut(input?.domain || name);
    default:
      return cut(name);
  }
}
