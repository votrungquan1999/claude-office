const MAX_NAME_LENGTH = 60;

// A real slash command is "/word" alone or followed by arguments; "/Users/x" or "/ is" are ordinary text.
const SLASH_COMMAND = /^\/[\w:-]+(\s|$)/;
// Blocks Claude Code injects as user turns; other "<tag>" text is something the owner typed.
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
  const candidates = [
    inputs.cardSummary,
    inputs.cardTitle,
    inputs.firstMessage,
    inputs.registryName,
  ];
  return candidates.find((name) => name?.trim());
}

/**
 * A prompt turned into a desk name.
 * @param prompt - What the owner typed.
 * @returns The prompt cut short on one line, or undefined when it is a command or empty.
 */
export function firstRealMessage(prompt: string): string | undefined {
  const text = prompt.replace(/\s+/g, " ").trim();
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
