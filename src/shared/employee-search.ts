import { folderName } from "./employee-name";
import type { SessionDto } from "./session";

/** Where in an employee a query matched. */
export type MatchField = "name" | "automatic" | "tab" | "request" | "step";

/** The text of an employee that search reads. */
export interface SearchFields {
  /** The name the employee goes by: the owner's, else the automatic one. */
  names: string[];
  /** The automatic name of an employee the owner renamed, which the owner may still remember. */
  automaticName?: string;
  /** The conversation tab's name, which the desk name may not show. */
  tab?: string;
  request?: string;
  step?: string;
}

/** A matched stretch of text, cut so the hit can be highlighted. */
export interface MatchSnippet {
  pre: string;
  hit: string;
  post: string;
}

/** Why an employee matched. */
export interface EmployeeMatch {
  field: MatchField;
  snippet: MatchSnippet;
}

/**
 * The text of an employee that search reads.
 * @param session - The employee's session.
 * @returns Its names, tab name, first request and latest step.
 */
export function fieldsOf(session: SessionDto): SearchFields {
  const automaticName = session.deskName ?? folderName(session.cwd);
  const step =
    session.runningSteps?.at(-1)?.text ?? session.recentSteps?.at(-1)?.text;
  return {
    names: [session.ownerName ?? automaticName],
    ...(session.ownerName ? { automaticName } : {}),
    ...(session.tabName ? { tab: session.tabName } : {}),
    ...(session.request ? { request: session.request } : {}),
    ...(step ? { step } : {}),
  };
}

/** A text with accents removed and capitals lowered, remembering where each letter came from. */
interface Folded {
  text: string;
  /** Per folded letter: where its original letter starts and ends. */
  origin: Array<{ start: number; end: number }>;
}

/**
 * Lowers capitals and removes accents, with đ read as d.
 * @param text - Any text.
 * @returns The folded text and the original position of each of its letters.
 */
function fold(text: string): Folded {
  let folded = "";
  const origin: Folded["origin"] = [];
  let at = 0;
  for (const char of text) {
    const plain = char
      .replace("đ", "d")
      .replace("Đ", "D")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (const letter of plain) {
      folded += letter;
      origin.push({ start: at, end: at + char.length });
    }
    at += char.length;
  }
  return { text: folded, origin };
}

/**
 * Whether a word may start at a position: after punctuation or a space, or at a capital inside a camel-case word.
 * @param text - The original text.
 * @param at - A position in it.
 * @returns True when a word starts there.
 */
function startsWord(text: string, at: number): boolean {
  if (at === 0) return true;
  const before = text[at - 1];
  if (!/[\p{L}\p{N}\p{M}]/u.test(before)) return true;
  return /\p{Ll}/u.test(before) && /\p{Lu}/u.test(text[at]);
}

/**
 * Finds where every word of a query starts a word in one text.
 * @param words - The query's folded words.
 * @param text - The text to search.
 * @returns The stretch of the original text from the first matched word to the last matched one; null when a word has no match.
 */
function findWords(
  words: string[],
  text: string,
): { start: number; end: number } | null {
  const { text: folded, origin } = fold(text);
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const word of words) {
    let found = -1;
    for (
      let at = folded.indexOf(word);
      at !== -1;
      at = folded.indexOf(word, at + 1)
    ) {
      const first = at === 0 || origin[at - 1].start !== origin[at].start;
      if (first && startsWord(text, origin[at].start)) {
        found = at;
        break;
      }
    }
    if (found === -1) return null;
    start = Math.min(start, origin[found].start);
    end = Math.max(end, origin[found + word.length - 1].end);
  }
  return { start, end };
}

/** How many characters of context a snippet keeps on each side of the hit. */
const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 50;

/**
 * Cuts the text next to a hit to a line of context.
 * @param text - Everything on one side of the hit.
 * @param side - Which side of the hit it is on.
 * @returns The nearest stretch on one line, with an ellipsis where it was cut.
 */
function windowed(text: string, side: "before" | "after"): string {
  const keep = side === "before" ? CONTEXT_BEFORE : CONTEXT_AFTER;
  const cut = text.length > keep;
  if (side === "before") {
    return `${cut ? "…" : ""}${(cut ? text.slice(-keep) : text).replace(/\s+/g, " ")}`;
  }
  return `${(cut ? text.slice(0, keep) : text).replace(/\s+/g, " ")}${cut ? "…" : ""}`;
}

/**
 * Finds why an employee matches a query.
 * @param query - What the owner typed.
 * @param fields - The employee's searchable text.
 * @returns The first field, Name, Automatic name, Tab name, First request, then Last step, where every query word starts a word; null when none does.
 */
export function matchEmployee(
  query: string,
  fields: SearchFields,
): EmployeeMatch | null {
  const words = fold(query).text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const candidates: Array<[MatchField, string]> = [
    ...fields.names.map((name): [MatchField, string] => ["name", name]),
    ["automatic", fields.automaticName ?? ""],
    ["tab", fields.tab ?? ""],
    ["request", fields.request ?? ""],
    ["step", fields.step ?? ""],
  ];
  for (const [field, text] of candidates) {
    const range = findWords(words, text);
    if (range) {
      return {
        field,
        snippet: {
          pre: windowed(text.slice(0, range.start), "before"),
          hit: text.slice(range.start, range.end),
          post: windowed(text.slice(range.end), "after"),
        },
      };
    }
  }
  return null;
}

/**
 * Orders matches for the palette: Name, then Automatic name, then Tab name, then First request, then Last step; ties keep their order.
 * @param hits - Matches with whatever else the caller carries.
 * @returns The hits in ranked order.
 */
export function rankMatches<T extends { match: EmployeeMatch }>(
  hits: T[],
): T[] {
  const order: MatchField[] = ["name", "automatic", "tab", "request", "step"];
  // Array.sort is stable, so equal fields keep the caller's order
  return [...hits].sort(
    (a, b) => order.indexOf(a.match.field) - order.indexOf(b.match.field),
  );
}
