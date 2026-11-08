const MAX_NAME_LENGTH = 60;

/** The name of a desk whose first message was only a paste. */
export const PASTED_TEXT_NAME = "Pasted text";

// A paste block: the close tag repeats the open tag's attributes (`</pasted_content id="d1">`), so an inner tag with another id stays in the body; an unclosed block runs to the end.
// The hook's body-less placeholder `<pasted_content/>` is tried first so it never swallows the typed words after it; it has no capture groups.
const PASTE_BLOCK =
  /<pasted_content\s*\/>|<pasted_content\b([^>]*)>([\s\S]*?)(?:<\/pasted_content\1>|$)/g;

// A real slash command is "/word" alone or followed by arguments; "/Users/x" or "/ is" are ordinary text.
const SLASH_COMMAND = /^\/[\w:-]+(\s|$)/;
// A leading "<tag …>…</tag>" block; Claude Code injects these as user turns under ever-new tag names.
const LEADING_BLOCK = /^<([A-Za-z][\w:.-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/;
// An injected block that never closes (cut off); other "<tag>" text is something the owner typed.
const SYSTEM_TAG =
  /^<(command-[\w-]+|local-command-[\w-]+|system-reminder|ide[_-][\w-]+|bash-(input|stdout|stderr)|task-notification)[\s>]/;
const INTERRUPT = /^\[Request interrupted by user/;

export interface DeskNameInputs {
  cardSummary?: string;
  cardTitle?: string;
  firstMessage?: string;
  registryName?: string;
}

/**
 * The name shown on a desk.
 * @param inputs - Every source the name can come from; blank ones count as absent.
 * @returns The first available of card summary, card title, first message, registry name.
 */
export function resolveDeskName(inputs: DeskNameInputs): string | undefined {
  // The owner's /rename is a better name than the paste placeholder.
  const placeholder = inputs.firstMessage === PASTED_TEXT_NAME;
  const candidates = [
    inputs.cardSummary,
    inputs.cardTitle,
    ...(placeholder
      ? [inputs.registryName, inputs.firstMessage]
      : [inputs.firstMessage, inputs.registryName]),
  ];
  return candidates.find((name) => name?.trim());
}

/**
 * Tells whether a prompt is a paste with no typed words.
 * @param prompt - What the owner sent, with paste blocks in it.
 * @returns True when the prompt holds a paste block and nothing else.
 */
export function isPasteOnly(prompt: string): boolean {
  return (
    prompt.includes("<pasted_content") &&
    !prompt.replace(PASTE_BLOCK, " ").trim()
  );
}

/**
 * A prompt turned into a desk name.
 * @param prompt - What the owner typed.
 * @returns The prompt, minus paste blocks and leading injected blocks, cut short on one line; "Pasted text" when it was only a paste; undefined when it is a command or nothing is left.
 */
export function firstRealMessage(prompt: string): string | undefined {
  if (isPasteOnly(prompt)) return PASTED_TEXT_NAME;
  let text = prompt.replace(PASTE_BLOCK, " ").replace(/\s+/g, " ").trim();
  while (LEADING_BLOCK.test(text)) text = text.replace(LEADING_BLOCK, "");
  // Commands, bash-mode shell input ("!"), injected blocks and interrupt notices are not a description of the task.
  if (
    !text ||
    text.startsWith("!") ||
    SLASH_COMMAND.test(text) ||
    SYSTEM_TAG.test(text) ||
    INTERRUPT.test(text)
  ) {
    return undefined;
  }
  // Counted in code points so an emoji is never cut in half.
  const letters = Array.from(text);
  if (letters.length <= MAX_NAME_LENGTH) return text;
  return `${letters.slice(0, MAX_NAME_LENGTH - 1).join("")}…`;
}
