import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OFFICE_HOOK_EVENTS } from "./hook-entries";
import { installHooks } from "./install-hooks";

const USAGE_PROMPT = {
  hooks: [
    {
      type: "command",
      command: "node /home/u/.claude/claude-usage/hooks/user-prompt-submit.mjs",
    },
  ],
};
const USAGE_START = {
  hooks: [
    {
      type: "command",
      command: "node /home/u/.claude/claude-usage/hooks/session-start.mjs",
    },
  ],
};

/** Shaped like the owner's real file: other tools' hooks, status line, env and MCP servers. */
const OWNERS_SETTINGS = {
  env: { SECRET_TOKEN: "do-not-print-me" },
  hooks: {
    UserPromptSubmit: [USAGE_PROMPT],
    SessionStart: [USAGE_START],
  },
  statusLine: { type: "command", command: "node status.mjs" },
  mcpServers: { demo: { command: "demo" } },
};

describe("installing the office hooks", () => {
  let home: string;
  let repo: string;
  let settingsFile: string;
  let printed: string[];

  const install = () =>
    installHooks({ home, repoRoot: repo, print: (line) => printed.push(line) });
  const writeSettings = (content: unknown, mode = 0o644) => {
    writeFileSync(
      settingsFile,
      typeof content === "string" ? content : JSON.stringify(content, null, 4),
    );
    chmodSync(settingsFile, mode);
  };
  const readSettings = () => JSON.parse(readFileSync(settingsFile, "utf8"));
  const claudeDir = () => join(home, ".claude");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-office-install-"));
    repo = mkdtempSync(join(tmpdir(), "claude-office-repo-"));
    mkdirSync(claudeDir(), { recursive: true });
    settingsFile = join(claudeDir(), "settings.json");
    printed = [];
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("adds the office entries on every event next to the owner's own hooks and keeps everything else", () => {
    // Given the owner's settings with other tools' hooks, mode 0644
    writeSettings(OWNERS_SETTINGS);
    const before = readFileSync(settingsFile, "utf8");

    // When setup installs the hooks
    const result = install();

    // Then the other tools' entries are still first on their events, and the office is on all 15
    const settings = readSettings();
    expect(result.settings).toBe("updated");
    expect(settings.hooks.UserPromptSubmit[0]).toEqual(USAGE_PROMPT);
    expect(settings.hooks.SessionStart[0]).toEqual(USAGE_START);
    expect(Object.keys(settings.hooks).sort()).toEqual(
      [...OFFICE_HOOK_EVENTS].sort(),
    );
    for (const event of OFFICE_HOOK_EVENTS) {
      const commands = settings.hooks[event].flatMap(
        (group: { hooks: Array<{ command: string }> }) =>
          group.hooks.map((hook) => hook.command),
      );
      expect(
        commands.filter((command: string) =>
          command.includes("/claude-office/hooks/claude-office-hook.mjs"),
        ),
      ).toHaveLength(1);
    }

    // And nothing outside hooks changed, the mode is kept, and one backup holds the original
    const { hooks: _hooks, ...rest } = settings;
    const { hooks: _original, ...originalRest } = OWNERS_SETTINGS;
    expect(rest).toEqual(originalRest);
    expect(statSync(settingsFile).mode & 0o777).toBe(0o644);
    expect(readFileSync(`${settingsFile}.backup-claude-office`, "utf8")).toBe(
      before,
    );

    // And the link points at the repo, and nothing printed the env values
    expect(readlinkSync(join(claudeDir(), "claude-office"))).toBe(repo);
    expect(printed.join("\n")).not.toContain("do-not-print-me");
    expect(readdirSync(claudeDir()).sort()).toEqual([
      "claude-office",
      "settings.json",
      "settings.json.backup-claude-office",
    ]);
  });

  it("changes nothing when run again: same bytes, same modification time, no new files", () => {
    // Given settings that setup already patched once
    writeSettings(OWNERS_SETTINGS);
    install();
    const bytes = readFileSync(settingsFile, "utf8");
    const modified = statSync(settingsFile).mtimeMs;
    const files = readdirSync(claudeDir()).sort();

    // When setup runs again
    const result = install();

    // Then nothing was touched
    expect(result).toEqual({ link: "unchanged", settings: "unchanged" });
    expect(readFileSync(settingsFile, "utf8")).toBe(bytes);
    expect(statSync(settingsFile).mtimeMs).toBe(modified);
    expect(readdirSync(claudeDir()).sort()).toEqual(files);
  });

  it.each([
    ["unparseable JSON", "{ not json", /settings\.json.*not valid JSON/],
    [
      "a hooks list that is not an array",
      JSON.stringify({ hooks: { Stop: { oops: true } } }),
      /hooks\.Stop.*array/,
    ],
  ])(
    "stops without touching anything when settings hold %s",
    (_name, content, message) => {
      // Given a settings file setup cannot safely merge into
      writeSettings(content);

      // When setup runs
      // Then it refuses with a clear reason
      expect(() => install()).toThrow(message);

      // And the file is untouched, with no backup or temp file left behind
      expect(readFileSync(settingsFile, "utf8")).toBe(content);
      expect(readdirSync(claudeDir())).toEqual(["settings.json"]);
    },
  );

  it("keeps a foreign hook that shares a group with an old office entry and leaves exactly one office hook per event", () => {
    // Given old-shape office entries: one sharing a group with another tool's hook, one with a matcher and no async flag
    const oldCommand =
      "node /home/u/.claude/claude-office/hooks/claude-office-hook.mjs";
    const foreign = { type: "command", command: "node other-tool.mjs" };
    writeSettings({
      hooks: {
        Stop: [
          { hooks: [foreign, { type: "command", command: oldCommand }] },
          USAGE_START,
          { hooks: [{ type: "command", command: oldCommand }, foreign] },
        ],
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: oldCommand }],
          },
        ],
      },
    });

    // When setup runs
    install();

    // Then the foreign hook and its position survive and the old office hook became the new one, in place
    const { hooks } = readSettings();
    expect(hooks.Stop[0].hooks[0]).toEqual(foreign);
    expect(hooks.Stop[0].hooks[1]).toMatchObject({
      async: true,
      command: expect.stringContaining("|| true"),
    });
    expect(hooks.Stop[1]).toEqual(USAGE_START);
    expect(hooks.Stop).toHaveLength(3);
    // And the repeated office hook in a later group is gone while its foreign neighbour stays
    expect(hooks.Stop[2].hooks).toEqual([foreign]);
    const officeStop = hooks.Stop.flatMap(
      (group: { hooks: { command: string }[] }) => group.hooks,
    ).filter((hook: { command: string }) =>
      hook.command.includes("claude-office-hook"),
    );
    expect(officeStop).toHaveLength(1);
    expect(hooks.Stop[0].hooks).toHaveLength(2);
    // And a stale matcher no longer limits the office entry
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0].matcher).toBeUndefined();
    expect(hooks.PreToolUse[0].hooks[0]).toMatchObject({ async: true });
  });

  it("patches a symlinked settings file at its target and keeps it a symlink", () => {
    // Given settings.json is a symlink into a dotfiles folder
    const dotfiles = mkdtempSync(join(tmpdir(), "claude-office-dotfiles-"));
    try {
      const real = join(dotfiles, "settings.json");
      writeFileSync(real, JSON.stringify(OWNERS_SETTINGS));
      chmodSync(real, 0o640);
      symlinkSync(real, settingsFile);

      // When setup runs
      install();

      // Then the target is patched with its mode and backup beside it, and the link is intact
      expect(lstatSync(settingsFile).isSymbolicLink()).toBe(true);
      expect(readlinkSync(settingsFile)).toBe(real);
      expect(JSON.parse(readFileSync(real, "utf8")).hooks.Stop).toHaveLength(1);
      expect(statSync(real).mode & 0o777).toBe(0o640);
      expect(existsSync(`${real}.backup-claude-office`)).toBe(true);
      expect(existsSync(`${settingsFile}.backup-claude-office`)).toBe(false);
    } finally {
      rmSync(dotfiles, { recursive: true, force: true });
    }
  });

  it("creates private settings when none exist, with no backup", () => {
    // Given no settings file at all
    // When setup runs
    const result = install();

    // Then a new file holds just the office hooks, private to the user
    expect(result.settings).toBe("created");
    expect(Object.keys(readSettings().hooks)).toHaveLength(15);
    expect(statSync(settingsFile).mode & 0o777).toBe(0o600);
    expect(existsSync(`${settingsFile}.backup-claude-office`)).toBe(false);
  });

  it("refuses to replace a real folder where the link belongs and leaves the settings untouched", () => {
    // Given a real folder at ~/.claude/claude-office
    mkdirSync(join(claudeDir(), "claude-office"));
    writeSettings(OWNERS_SETTINGS);
    const before = readFileSync(settingsFile, "utf8");

    // When setup runs
    // Then it refuses and changes nothing
    expect(() => install()).toThrow(/not a symlink/);
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(join(claudeDir(), "claude-office"))).toBe(true);
  });

  it("points a link left over from a moved checkout at the current repo", () => {
    // Given a link to an old checkout
    symlinkSync(
      "/nonexistent/old-checkout",
      join(claudeDir(), "claude-office"),
    );

    // When setup runs
    const result = install();

    // Then the link follows the repo
    expect(result.link).toBe("relinked");
    expect(readlinkSync(join(claudeDir(), "claude-office"))).toBe(repo);
  });
});
