# Set up this Mac for Claude Office

These steps are for Claude to follow on a new Mac. Run them from the repo's folder (the one holding `package.json`). Each step is safe to run again.

## 1. Check Node

Run `node -v`. It must print v24 or newer (the repo's `.nvmrc` says 24). If it is older or missing, stop and tell the owner to install Node 24 or newer (for example `brew install node`); do not install it yourself.

Why: the agent runs TypeScript directly through `tsx` on Node's own loader, which needs a recent Node.

## 2. Install the dependencies

Run `npm install`. Use the plain command, not `--omit=dev`: `tsx` is a dev dependency and the agent needs it at run time.

## 3. Connect this Mac

Run `npm run setup`. It does the following:

- Asks the office for a connect request named after this Mac's computer name, and prints a link and an 8-character code such as `ABCD-2345`.
- Opens the link in the default browser. If no browser opens (SSH, no desktop), the link is still printed; the owner can open it on any device.
- Waits up to 10 minutes for the owner to approve.

Tell the owner, in plain words, to do this:

- Sign in with Google if the page asks.
- Check that the page names this Mac and shows the same code as the terminal. If the code differs, do not click: someone else made that link.
- Click "Connect this Mac".

When approved, the command saves the database connection to `~/.claude-office/config.json` (readable only by this user) and prints "Connected". It never prints the connection string. Running setup again keeps a valid saved connection and skips this step; run `npm run setup -- --reconnect` to ask for a new approval and replace it.

Use `CLAUDE_OFFICE_URL` to point setup at a different office address; the default is `https://office.quanvo.dev`.

If it fails with "too many connect requests", wait a few minutes (open requests expire after 10 minutes) and run it again.

After pulling a new version on a Mac, restart its agent so it runs the new code: `launchctl kickstart -k gui/$(id -u)/dev.quanvo.claude-office.agent`. The hooks run from this checkout through the `~/.claude/claude-office` link, so they update with it; run `npm run setup` again only if the checkout moved.

## 4. Install the hooks

`npm run setup` does this right after connecting; nothing more to run. It:

- Links `~/.claude/claude-office` to this repo, so hooks keep working through that fixed path.
- Adds one async command hook for each of the 15 events the office reads to `~/.claude/settings.json`, next to any hooks already there (for example claude-usage's). Other tools' hooks, `statusLine`, `env` and `mcpServers` are left exactly as they are; the command never prints `env` values.
- Saves a one-time backup of the original as `~/.claude/settings.json.backup-claude-office` the first time it changes the file. The first change may reformat the file to 2-space JSON; later runs change nothing.

If settings.json is not valid JSON, or a hook list is not an array, setup stops with a message and changes nothing; tell the owner what it printed.

Check it worked: `jq '.hooks | keys' ~/.claude/settings.json` should list `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `Notification`, `Stop`, `StopFailure`, `Elicitation`, `ElicitationResult`, `SubagentStart` and `SubagentStop`. Running Claude sessions pick the change up by themselves; if one does not show up in the office, restart that session.

The hooks never slow or block Claude: they are async, always exit 0 and print nothing, even when the agent is not running.

There is no uninstall command. To remove the office by hand: delete the entries whose command contains `/claude-office/hooks/claude-office-hook.mjs` from `~/.claude/settings.json` (or restore the backup if nothing else changed since), delete the `~/.claude/claude-office` link (`rm ~/.claude/claude-office`; it is a link, so the repo is not touched), and delete `~/.claude/settings.json.backup-claude-office`.

## 5. Start the agent at login

`npm run setup` does this last; nothing more to run. It writes `~/Library/LaunchAgents/dev.quanvo.claude-office.agent.plist` and loads it, so the agent starts when the owner logs in and macOS restarts it if it stops. The plist runs Homebrew's `node` (`/opt/homebrew/bin/node`, else `/usr/local/bin/node`, else the `node` that ran setup; it must be v24 or newer) with the repo folder reached through `~/.claude/claude-office`, and holds no secrets. Re-running setup reloads the job only when the plist changed. If nobody is logged in at the Mac's desktop (for example over SSH), setup keeps the plist and says so; ask the owner to log in at the desktop and run `npm run setup` again.

The agent also exits by itself after about 5 minutes with no successful database write (for example after the Mac slept with a dead connection); the login job then starts a fresh one. Its log, `~/.claude-office/logs/agent.log`, is emptied at start when it passes 5 MB.

Confirm it is running:

- `launchctl print gui/$(id -u)/dev.quanvo.claude-office.agent | grep -E 'state|pid'` should show `state = running` and a pid.
- `tail ~/.claude-office/logs/agent.log` should show no repeating errors. One line saying it is waiting for `~/.claude-office/config.json` means step 3 did not finish.
- `~/.claude-office/agent.json` exists and its `pid` is alive: `kill -0 $(jq .pid ~/.claude-office/agent.json) && echo alive`.

If the repo lives under `~/Documents`, macOS may ask the owner to let `node` access the Documents folder the first time the agent starts at login. Look in the log for `EPERM` or `Operation not permitted`; if present, tell the owner to open System Settings, Privacy & Security, Files and Folders (or Full Disk Access), allow `node`, and then run `launchctl kickstart gui/$(id -u)/dev.quanvo.claude-office.agent` or log out and in.

Stop it for now: `launchctl bootout gui/$(id -u)/dev.quanvo.claude-office.agent` (it starts again at the next login, or when setup is run again).

Remove it by hand: run that `bootout`, delete `~/Library/LaunchAgents/dev.quanvo.claude-office.agent.plist`, and optionally delete `~/.claude-office/` (config, address file and logs). Then remove the hooks and the link as described in step 4.

## Terminal windows the office opens

When the owner hires an employee from the office, the agent opens a Terminal window on this Mac. Two things to know:

- **Click the window before typing.** The window may not be focused when it opens, so keystrokes can go to the app that was in front. Why: macOS lets a script open a window but does not always give it focus.
- **The trust question defaults to "No, exit".** In a folder Claude Code has not trusted, the window stops at "Do you trust this folder?". Choosing the default ends Claude Code, so pick "Yes" to let the employee start. Why: the office shows that hire as "waiting at the Mac" until Claude Code registers, and after 30 minutes without Claude Code registering it shows "Not running" instead, and can be woken.

The agent only reads `~/.claude.json` to warn about untrusted folders; it never writes to it.

## Optional: name every desk with an Anthropic key

By default a desk shows the first message cut to 60 characters (or "Pasted text" for a pasted-only message). To have a short task name of at most 6 words written from the first message instead, add an Anthropic API key to `~/.claude-office/config.json`, next to the two database fields:

```json
{ "mongodbUri": "...", "mongodbDb": "...", "anthropicApiKey": "sk-ant-..." }
```

- **What is sent:** at most the first 1,000 characters of each session's first message (pasted text included) go to Anthropic (model `claude-haiku-5-5`), once per session (one retry if Anthropic is briefly unavailable). The same key also lets the agent ask Haiku, each time a turn ends, whether the last answer asks you to answer, choose or approve something (so the desk shows Waiting for you): at most the last 1,000 characters of that answer are sent, with no retry; if the call fails the built-in rule decides. Nothing else leaves the Mac, and the key is never logged or stored in the database.
- **When it is read:** the agent reads the file only when it starts, so restart it after adding the key: `launchctl kickstart -k gui/$(id -u)/dev.quanvo.claude-office.agent`. Sessions that are already running get their name right after the restart.
- **A failed request:** a session whose request failed for good (for example Anthropic rejected it) keeps the first-message name and is not asked again. A wrong or revoked key is not a failure for good: after you fix the key and restart the agent, those sessions are asked again. The same holds when Haiku replies `NONE` (the message does not say what the task is) or with something longer than a desk name.
- **Without a key** (or with a blank one) nothing is sent and the desk keeps the first-message name. Running `npm run setup -- --reconnect` keeps the key.
- Answers are cached in `~/.claude-office/task-names.json`, so a restart does not ask again.

## Running the web app locally (optional)

Only needed to work on the web app itself; a Mac that just reports sessions never runs it.

- Copy `.env.example` to `.env.local` and fill in the values from [Deploy the web app](README.md#deploy-the-web-app), keeping `BETTER_AUTH_URL=http://localhost:3000`.
- The Google OAuth client must list `http://localhost:3000/api/auth/callback/google` as an authorised redirect URI (next to the production one).
- Run `npm run dev` and open http://localhost:3000. It reads and writes the database in `MONGODB_URI`; use a throwaway database.
