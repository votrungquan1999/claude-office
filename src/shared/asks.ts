const LAST_LINES = 3;

/** Phrases that ask the owner to reply when they open a sentence; a bare "which" does not, so "which is why…" stays a statement. */
const ASKING_PHRASES =
  /(?:^|[.!?:]\s+)(?:tell me|let me know|say the word|want me to|should i|do you want|which (?:one|option|approach|of|do you|would you|should we))\b/i;

/**
 * Whether an assistant's last answer asks the owner something.
 * @param text - The answer's text, or undefined when the hook sent none.
 * @returns True when the owner is expected to reply.
 */
export function asks(text: string | undefined): boolean {
  if (!text) return false;
  // A "?" inside a code block is code, not a question
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, "");
  const lines = prose
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-LAST_LINES);
  return lines.some(
    (line) => /\?[\s*_"')\]]*$/.test(line) || ASKING_PHRASES.test(line),
  );
}
