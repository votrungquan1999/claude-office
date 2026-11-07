import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildOfficeHookEntries, type OfficeHookEntry } from "./hook-entries";

export interface InstallHooksOptions {
  /** The user's home folder. */
  home: string;
  /** The repo checkout the `~/.claude/claude-office` link points at. */
  repoRoot: string;
  print?: (line: string) => void;
}

export interface InstallHooksResult {
  link: "created" | "relinked" | "unchanged";
  settings: "created" | "updated" | "unchanged";
}

/** Our hook's command names this script, wherever the repo was cloned; older installs had it bare at the end, newer ones quoted and followed by shell guards. */
const OFFICE_HOOK_SCRIPT = "/claude-office/hooks/claude-office-hook.mjs";
const BACKUP_SUFFIX = ".backup-claude-office";
const MAX_WRITE_ATTEMPTS = 3;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The hook list of one settings group; a malformed group counts as someone else's and has none of ours. */
function hooksOf(group: unknown): unknown[] {
  return isObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
}

function isOurs(hook: unknown): boolean {
  return (
    isObject(hook) &&
    typeof hook.command === "string" &&
    hook.command.includes(OFFICE_HOOK_SCRIPT)
  );
}

/**
 * Puts the office entry into each event's list: in place of ours when present, else at the end,
 * and never touches another tool's hooks.
 * @param text - The settings file's text, or undefined when there is no file.
 * @param entries - The office entries by event.
 * @param label - The file's name for error messages.
 * @returns The new text.
 */
function mergeSettings(
  text: string | undefined,
  entries: Record<string, OfficeHookEntry>,
  label: string,
): string {
  let settings: unknown = {};
  if (text !== undefined) {
    try {
      settings = JSON.parse(text);
    } catch {
      throw new Error(
        `${label} is not valid JSON; fix it and run setup again. Nothing was changed.`,
      );
    }
  }
  if (!isObject(settings)) {
    throw new Error(`${label} is not a JSON object. Nothing was changed.`);
  }
  if (settings.hooks !== undefined && !isObject(settings.hooks)) {
    throw new Error(
      `"hooks" in ${label} is not an object. Nothing was changed.`,
    );
  }
  const hooks: Json = isObject(settings.hooks) ? settings.hooks : {};
  settings.hooks = hooks;

  for (const [event, entry] of Object.entries(entries)) {
    const existing = hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new Error(
        `hooks.${event} in ${label} is not an array. Nothing was changed.`,
      );
    }
    const groups: unknown[] = existing ?? [];
    let placed = false;
    hooks[event] = groups.flatMap((group) => {
      const ours = hooksOf(group).filter(isOurs).length;
      if (ours === 0) return [group];
      // Later copies are dropped so each event ends with exactly one office hook.
      if (placed) {
        const rest = hooksOf(group).filter((hook) => !isOurs(hook));
        return rest.length ? [{ ...(group as Json), hooks: rest }] : [];
      }
      placed = true;
      // A group that held only office hooks is replaced whole, which also drops a stale matcher.
      if (ours === hooksOf(group).length) return [structuredClone(entry)];
      let swapped = false;
      const swappedHooks = hooksOf(group).flatMap((hook) => {
        if (!isOurs(hook)) return [hook];
        if (swapped) return [];
        swapped = true;
        return [structuredClone(entry.hooks[0])];
      });
      return [{ ...(group as Json), hooks: swappedHooks }];
    });
    if (!placed) (hooks[event] as unknown[]).push(structuredClone(entry));
  }
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Makes `~/.claude/claude-office` a link to this checkout; hooks run the script through it, so
 * moving the checkout only needs setup run again.
 * @param linkPath - Where the link belongs.
 * @param target - The checkout.
 * @returns What happened.
 */
function ensureLink(
  linkPath: string,
  target: string,
): InstallHooksResult["link"] {
  const existing = lstatSync(linkPath, { throwIfNoEntry: false });
  if (!existing) {
    symlinkSync(target, linkPath);
    return "created";
  }
  if (!existing.isSymbolicLink()) {
    throw new Error(
      `${linkPath} exists and is not a symlink; move it aside and run setup again.`,
    );
  }
  if (readlinkSync(linkPath) === target) return "unchanged";
  // Only the link itself is removed, never what it points at.
  unlinkSync(linkPath);
  symlinkSync(target, linkPath);
  return "relinked";
}

/**
 * Where settings really live: a settings.json that is a symlink (dotfiles) is patched at its target.
 * @param file - The settings path.
 * @returns The real path, or the path itself when there is no file yet.
 */
function resolveSettingsPath(file: string): string {
  const entry = lstatSync(file, { throwIfNoEntry: false });
  if (!entry) return file;
  // Throws for a dangling link, which stops setup rather than replacing the link.
  return entry.isSymbolicLink() ? realpathSync(file) : file;
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Writes the merged settings beside the target and renames it in, so Claude Code never reads a
 * half file, and re-merges when the file changed while setup worked.
 * @param target - The real settings path.
 * @param entries - The office entries by event.
 * @returns What happened.
 */
function writeSettings(
  target: string,
  entries: Record<string, OfficeHookEntry>,
): InstallHooksResult["settings"] {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const current = readIfExists(target);
    const merged = mergeSettings(current, entries, target);
    if (merged === current) return "unchanged";

    if (current !== undefined) {
      try {
        copyFileSync(
          target,
          `${target}${BACKUP_SUFFIX}`,
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        // An earlier run's backup holds the owner's original and is kept.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const mode = current === undefined ? 0o600 : statSync(target).mode & 0o777;
    const temp = `${target}.claude-office-${process.pid}.tmp`;
    try {
      writeFileSync(temp, merged);
      // chmod, since the umask may strip bits the original file had.
      chmodSync(temp, mode);
      if (readFileSync(temp, "utf8") !== merged) {
        throw new Error("The settings temp file did not read back as written.");
      }
      // Another tool wrote meanwhile: start over from its version.
      if (readIfExists(target) !== current) continue;
      renameSync(temp, target);
      return current === undefined ? "created" : "updated";
    } finally {
      rmSync(temp, { force: true });
    }
  }
  throw new Error(
    `${target} kept changing while setup updated it; run setup again.`,
  );
}

/**
 * Adds the office hooks to Claude Code's user settings next to whatever hooks are already there.
 * @param options - The home folder and the repo root.
 * @returns What changed.
 */
export function installHooks(options: InstallHooksOptions): InstallHooksResult {
  const print = options.print ?? (() => {});
  const claudeDir = join(options.home, ".claude");
  const entries = buildOfficeHookEntries(options.home);
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = resolveSettingsPath(join(claudeDir, "settings.json"));

  // Checked before anything is changed, so an unusable settings file leaves the Mac as it was.
  mergeSettings(readIfExists(settingsPath), entries, settingsPath);

  const link = ensureLink(join(claudeDir, "claude-office"), options.repoRoot);
  const settings = writeSettings(settingsPath, entries);
  print(`Link ~/.claude/claude-office: ${link}`);
  print(`Hooks in ${settingsPath}: ${settings}`);
  return { link, settings };
}
