# Claude Office v1

A watch-only pixel-art office web app that shows every interactive Claude Code session on every set-up Mac of the owner, viewable from a Mac browser or a phone. Live at https://office.quanvo.dev (private repo `votrungquan1999/claude-office`, branch `main`).

Design background lives in `docs/brainstorm/`. Where it disagrees with this file, this file wins.

## Sections

- [What it is](#what-it-is)
- [Behaviors](#behaviors)
- [Privacy guarantees](#privacy-guarantees)
- [How the pieces fit](#how-the-pieces-fit)
- [Timings and limits](#timings-and-limits)
- [Setting up a Mac](#setting-up-a-mac)
- [Deployment](#deployment)
- [Decisions worth knowing](#decisions-worth-knowing)
- [Accepted limits](#accepted-limits)
- [Not in v1](#not-in-v1)
- [Open items](#open-items)
- [Key files](#key-files)
- [Quality record](#quality-record)

## What it is

- **Office view:** one pixel-art office with four labelled rooms: Working, Thinking, Needs permission, Waiting.
- **Employees:** each session is a character that sits in the room matching its state and moves when the state changes.
- **Details:** clicking or tapping an employee opens a panel with the desk name, Mac, folder, steps and the Remote Control link.
- **Went home:** closed sessions leave the office and appear in a "Went home today" list.
- **Sign-in:** Google only; one allowed account.
- **Machines:** each Mac runs a small background agent that reports to the shared database; the hosted app reads it.

## Behaviors

### Sign-in

- A signed-out visitor sees only the sign-in page; every page and office API checks the owner.
- Any Google account other than the allowed, verified email is refused, both when the user is created and when a session is created.
- Every page forbids being framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

### Office and rooms

- The layout has four named rooms, each with at least ten seats, joined by doorways.
- Working: a tool is running. Thinking: between steps. Needs permission: a dialog waits for the owner. Waiting: the turn is done.
- Other waits for the owner (questions, MCP forms) also go to Needs permission.
- Several open dialogs keep the employee in Needs permission until the last one is answered.
- A dialog raised by a subagent moves the parent session to Needs permission.
- When the session's own status reports it busy again after a dialog, the dialog counts as approved and the employee leaves Needs permission.
- A context compaction keeps the session's state instead of resetting it.
- An employee takes a free seat in its room; when the room is full it stands on the room's floor.
- State changes shorter than about 2 seconds are smoothed away.
- An idle employee wanders only inside its own room.
- Each session keeps the same character look wherever the office is loaded.

### Every session, every Mac

- Sessions from all set-up Macs appear in one office, each labelled with the Mac's computer name and its current folder; the folder follows `cd` and ignores subagents' folders.
- Only interactive sessions are shown; a session with no registry entry yet is held until one appears and is dropped after 10 quiet minutes if it never becomes interactive.
- A session that is already running when the agent starts is picked up from `~/.claude/sessions` and its transcript.
- `/clear` ends the old employee and a new one arrives.
- Sessions that never got a prompt are left out of the Went home list.

### Desk name

- The desk shows, in order: the AI-Kanban card summary, the card title, the first real user message cut to 60 characters, the session's own name.
- Slash commands, `!` bash-mode input and interrupt notices are not used as the first message.
- A message that starts with a `<tag …>…</tag>` block (any tag name) has that block removed, repeatedly, and the rest is used; if nothing is left the message is skipped and the next one is tried.
- A card created, renamed or removed later updates the desk; a name given with `/rename` later is picked up.

### Steps

- The details panel shows the last 5 steps with how long each took; "Show more" pages back up to a week.
- Step text: Read/Edit/Write show the verb and file name; Bash shows its description, else "Bash"; Agent shows "Agent: <description>"; Grep/Glob show "Search '<pattern>'"; WebSearch shows the query; WebFetch shows the domain; any other tool shows its name. Text is cut at 120 characters.
- The to-do tool is not a step; it sets the desk's current to-do line.
- Failed, denied and stopped steps are marked; an API-error turn end adds one "API error" step.
- Durations are never shown below zero; steps older than a week are hidden.
- A subagent's own tool events are skipped; the parent shows one "Agent: ..." step.

### Went home

- A closed session leaves the office and appears in "Went home today", newest first, with desk name, Mac, folder and time.
- "Today" is the browser's local day.
- Clicking an entry opens details with steps but no Remote Control link.
- A resumed session returns to the office.
- A session whose process died, or whose pid now belongs to another session, goes home; a session found already dead when the agent starts is dated no later than the Mac's last heartbeat.

### Remote Control

- The details panel shows "Open Remote Control" linking to `https://claude.ai/code/<bridgeSessionId>` (ids containing `/`, `?` or `#` give no link), or "Remote Control is off for this session".
- The newest event decides; an event without the id clears it.
- Clicking never navigates by itself; the link lives only in the panel.

### Staying right when hooks miss things

- The agent re-reads the session registry about every 5 seconds: a dead or reused process goes home, and a fresher registry status corrects a stale state. A process counts as the same one when its `ps` start time, read in UTC, equals the registry's `procStart` (Claude Code writes it in UTC).
- If the registry is unreadable or its format changed, the agent runs on hook events alone and sends nothing home.
- Late or out-of-order events do not move a session backwards; writes per session are serialized and steps are deduplicated by id.
- When the database is unreachable, the agent queues a bounded number of writes and catches up.
- Each Mac writes a heartbeat about every 60 seconds; after about 3 minutes without one the office greys that Mac's characters and labels the details "Mac offline".
- If `ps` fails at agent start-up, the agent refuses to start and launchd retries.

### Live updates

- The office page polls for changes about every 3 seconds only while the tab is visible, checks at once when the tab returns, and backs off on failures.
- It shows "Updated N min ago" and a "Connection lost" banner when polling fails; on a 401 it stops and sends the owner to sign-in.
- The changes API returns what changed since the browser's cursor, with a 5-second overlap, and the browser merges by (machine, session).

### Phone

- The office fits the screen, can be panned and pinch-zoomed, shows a select-only strip of employee cards, and the went-home list is a sheet.
- Tapping an employee or card opens the details panel, which scrolls on a small screen.

### Connecting a Mac

- `npm run setup` asks the office for a connect request named after the Mac and prints a link and an 8-character code.
- `/connect` shows the Mac name and the same code; only the signed-in owner can click "Connect this Mac".
- The Mac collects the database connection once; codes live 10 minutes; at most 5 unexpired codes exist at a time.
- Running setup again skips connecting when a valid saved config exists; `npm run setup -- --reconnect` forces a new approval.

### Hooks and agent install

- Setup adds one async command hook for each of 13 events to `~/.claude/settings.json`, next to existing hooks, backs the original up once, and changes nothing on a second run.
- The hook always exits 0, prints nothing, hands the event to the local agent and returns; it has a hard exit timer so a hung agent cannot slow Claude.
- The agent starts at login as a launchd LaunchAgent and restarts if it stops; it also exits by itself after about 5 minutes without a successful database write so launchd starts a fresh one. A long gap between checks is read as a Mac sleep and gets a fresh limit.

## Privacy guarantees

- The text of a shell command never leaves the Mac: the hook keeps only an allowlist of `tool_input` keys, and the agent's schema drops anything else again.
- Tool output, error text and notification text are never stored.
- Free text that is stored: the first message (60 characters), Bash and Agent descriptions, search patterns, web queries and domains, file names, the session's name and folder paths.
- The agent's config and address files are created readable only by the user.

## How the pieces fit

- **Hook:** `hooks/claude-office-hook.mjs` reduces each event and posts it to the loopback agent found through `~/.claude-office/agent.json`.
- **Agent:** TypeScript run with `node --import tsx` under `agent/`; tracks sessions, steps, desk names and heartbeat, and writes to MongoDB only when something changes.
- **Database:** the `claude-office` database on the shared Atlas M0 cluster; sessions carry their last 5 steps, full steps live in their own collection; every write stamps `changedAt` with the server's clock.
- **Web app:** Next.js on Vercel with better-auth (Google); the office page loads once, then polls the changes API.
- **Renderer:** pixel-agents v1.5.0 (commit b1bafd0, MIT) copied into `src/office/` with its licence and credits; characters credit JIK-A-4 MetroCity (CC0).
- **Shared code:** `src/shared/` holds the schemas, step text and desk-name rules used by both sides.

## Timings and limits

- Poll about 3 s while visible; changes overlap 5 s; registry check about 5 s; heartbeat about 60 s; Mac offline after about 3 min.
- Agent self-exit after about 5 min without a database write; held-session eviction after 10 min.
- Steps, sessions and Mac records expire 7 days after last seen; the agent renews open sessions at most daily.
- Connect code life 10 min; at most 5 open codes.
- Steps API pages default to 50, at most 200.

## Setting up a Mac

- The owner clones the repo and tells Claude to follow `SETUP.md`.
- It checks Node 24+, runs `npm install`, runs `npm run setup` (connect, hooks, LaunchAgent) and gives checks for each step.
- Removal is by hand and documented in `SETUP.md`; there is no uninstall command.
- Macs only; Windows is out of scope.

## Deployment

- Infra is in personal-infra PR #30 (merged): database user on the shared cluster, Vercel project linked to GitHub, Cloudflare DNS, domain `office.quanvo.dev`, env vars.
- The Google OAuth client and the allowed email are Pulumi config set by the owner.
- Live checks done: `/` redirects to `/sign-in`, `/sign-in` serves with the frame headers, the office API returns 401 signed out, `/connect` redirects to sign-in, and Google sign-in starts with the right client and redirect.
- The deploy run reported a provider error on the Vercel project that is cosmetic: the project is in state and a follow-up preview shows nothing to change.

## Decisions worth knowing

- **Machines write straight to the database:** the one-click connect hands the Mac its connection string; the owner rejected an extra API layer.
- **Hook to agent:** an async command hook posting to loopback, not an http hook, so a stopped agent never shows a hook error.
- **Change cursor:** server-clock `changedAt`, because Mac clocks differ and Vercel cannot hold a change stream.
- **Connect page shows Mac name and code:** a public create route could otherwise be used to phish a connection string through a crafted link.
- **Clicks open a panel:** no accidental navigation, the same on desktop and phone.
- **Subagents:** one "Agent: ..." step on the parent, no extra character.
- **Went home end time:** stamped once by the agent, so later re-writes of an ended session do not move it.
- **Visible 5 steps:** the latest-started steps, so parallel tools leave no gaps.
- **Offline Mac:** characters are greyed, not just the label.
- **No restart after sleep:** the write watchdog does not restart the agent merely because the Mac slept.
- **Phone test flake:** fixed in the test helper (it retries the tap until the selection changes), not by switching off wandering in the app.
- **Mutation survivors:** all four got tests rather than being accepted.
- **Hook install stays in this repo for v1;** moving it to AI-rules is later work.

## Accepted limits

- A database outage longer than about 5 minutes loses the steps queued during it.
- A stranger can fill the connect-code cap and block connecting for up to 10 minutes.
- Which hook fires after a manual "No" on a permission dialog is not verified, and whether already-open sessions pick up newly installed hooks is not verified; both are manual checks.
- The assumption that `/clear` keeps the process id is unchecked; the rule built on it is harmless if wrong.
- Furniture, floor and wall art provenance is unknown, so the repo stays private until checked.

## Not in v1

- Non-interactive sessions (`claude -p`, scheduled prompts, Agent SDK runs).
- Messaging sessions, auto-wake, hiring sessions, stop buttons, controlled updates, teams, push notifications, one-line summaries, per-session cost.
- An uninstall command.

## Open items

- Final check part 2: follow `SETUP.md` on the owner's Mac and see a live session at office.quanvo.dev from the Mac and a phone. It is pending the owner; the setup command was blocked in the agent's session.
- Manual checks listed in `tmp/office-v1/MANUAL_TESTS.md` while the run workspace exists.
- Add `.env.example` and a local sign-in note (redirect `http://localhost:3000/api/auth/callback/google`, override `BETTER_AUTH_URL`).
- Check the Vercel plan's function-call allowance against about 1,200 polls per hour per visible tab.
- Check licences of the copied art and font.

## Key files

- `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/require-owner.ts`: sign-in gate.
- `src/office/` (`sceneSync.ts`, `rooms.ts`, `offline.ts`, `wentHome.ts`, `remoteControl.ts`, `engine/`, `components/`): office rendering and scene sync.
- `src/app/office/`: office page, details panel, steps list, went-home list, polling hook, connection status.
- `src/app/api/office/changes`, `src/app/api/office/steps`, `src/app/api/connect/`: office and connect APIs.
- `src/shared/`: session, hook-event, step-text, desk-name, connect schemas and rules.
- `hooks/claude-office-hook.mjs`: the hook.
- `agent/`: `session-state.ts`, `tracker.ts`, `steps.ts`, `writer.ts`, `reconcile.ts`, `heartbeat.ts`, `write-watchdog.ts`, `kanban-watch.ts`, `start-agent.ts`, `main.ts`.
- `agent/setup/`: connect, hook install, launchd install.
- `SETUP.md`, `THIRD_PARTY_NOTICES.md`, `e2e/`.
- Infra: personal-infra PR #30 (`resources/claude-office.ts`).

## Quality record

- Built as 17 behaviors, one commit each on `main` (17 commits, pushed).
- At the end of the run: 51 vitest files with 177 tests, 21 of 21 Playwright specs, type-check and lint clean.
- Conformance check of behaviors 1-16: 16 reports, 13 valid, 3 valid with caveats; the caveats were fixed.
- Adversarial pass over the risk catalog of 56 risks: the findings were triaged and fixed; re-validation of the agent side and the view side found no remaining broken item.
- Mutation pass: 28 mutants over the command-text guard, the owner gate, the connect codes and the state reducer; 24 killed, 4 survived and each survivor now has a test.
