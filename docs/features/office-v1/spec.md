# Claude Office (version 0.3.0)

A pixel-art office web app that shows every interactive Claude Code session on every set-up Mac of the owner, viewable from a Mac browser or a phone, and lets the owner hire a new employee on an online Mac. Public repo `votrungquan1999/claude-office`, branch `main`, MIT licence.

This file is the living spec for the whole app (version 0.3.0); its folder is named `office-v1`.

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
- [Not built yet](#not-built-yet)
- [Open items](#open-items)
- [Key files](#key-files)
- [Quality record](#quality-record)

## What it is

- **Office view:** one pixel-art office, 34 by 22 tiles, with four labelled rooms: Working, Needs permission, Waiting for you, Idle.
- **Employees:** each session is a character that sits in the room matching its state and moves when the state changes.
- **Labels:** an employee's label is `desk name · Mac / project`, or `Mac / company name` when the session started at its company folder, followed by its repo tags as `#name`. It is shown only while the mouse is over the employee or it is selected (tap or click); permission and waiting bubbles are always shown.
- **Companies:** the folders sessions start in group into companies. A strip above the office has one tab per company and Mac, each with four counts; a drawer lists every Mac and company.
- **Details:** clicking or tapping an employee opens a pixel card: a state band (with how long the session has been in that state, and the project and tags), the desk name, a terminal-style box for what it is doing or wants to run, the Remote Control button, the recent steps, and the Mac and folder. The card is 360px wide on a desktop and a bottom sheet on a phone.
- **Went home:** closed sessions leave the office and appear in a "Went home today" list.
- **Sign-in:** Google only; one allowed account.
- **Machines:** each Mac runs a small background agent that reports to the shared database; the hosted app reads it.

## Behaviors

### Sign-in

- A signed-out visitor sees only the sign-in page; every page and office API checks the owner.
- Any Google account other than the allowed, verified email is refused, both when the user is created and when a session is created.
- Every page forbids being framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

### Office and rooms

- The layout has four named rooms joined by doorways, 72 seats in all: Working 24, Needs permission 12, Waiting for you 18, Idle 18. Working and Needs permission are on top, Waiting for you and Idle below.
- Working: a tool is running, or the session is between steps (thinking); both live in the same room, so an employee does not walk between the two.
- Needs permission: a dialog waits for the owner. Other waits for the owner (questions, MCP forms) also go here.
- Waiting for you: the turn ended and the last answer asked the owner something.
- Idle: the turn ended without asking. A session first seen after its turn ended with an unreadable transcript also shows Idle.
- Several open dialogs keep the employee in Needs permission until the last one is answered.
- A dialog raised by a subagent moves the parent session to Needs permission.
- When the session's own status reports it busy again after a dialog, the dialog counts as approved and the employee leaves Needs permission.
- A context compaction keeps the session's state.
- An employee takes a free seat in its room; when the room is full it stands on the room's floor, never in a doorway and never in another room.
- Each room's sign shows its name; when a room holds more employees than seats it reads `Needs permission 14 / 12`. Signs scale with the zoom so they do not cover seats on a phone.
- The busy look and the permission bubble change at once when the state changes; the walk to another room waits until the new state has held for 2 seconds, so a short flip does not send the employee walking.
- An idle employee wanders only inside its own room.
- Each session keeps the same character look wherever the office is loaded.
- The camera zoom is at least 2 on a 1280x800 desktop, a phone in portrait and a phone on its side. Below about 544 CSS px at 2x pixel density (360 px at 3x) the zoom falls to 1.

### Waiting for you or Idle

- When a turn ends (the Stop hook), the agent decides whether the last answer asked the owner something: it reads the last three non-empty lines with fenced code removed, and the answer asks when a line ends in `?` (a closing quote, bracket, `*` or `_` may follow) or a sentence starts with "tell me", "let me know", "say the word", "want me to", "should I", "do you want", or "which one / option / approach / of / do you / would you / should we". A bare "which" does not count.
- The hook sends the agent the end of the answer (about the last 1000 characters, with a cut code fence dropped) and a `stop_hook_active` flag; the answer text is used for the decision and never stored.
- A follow-up turn that a Stop hook started keeps a question the earlier Stop asked; a new prompt clears it.
- The state lasts until the owner answers; nothing times it out.
- A session already finished when the agent starts (or first seen later) gets the same decision from its transcript. A turn starts at the last user record that is not a tool result, not meta and not a compaction summary, whatever its origin, so a background-task turn after a question reads as Idle. An API-error record after the text ends the turn without a question. A transcript with only garbled lines is Idle.
- The registry's `idle` status ends a working or thinking turn; if the Stop was missed, the transcript tail decides Waiting for you or Idle. A registry `idle` also clears a stale dialog.
- Registry timestamps are compared with the last state-changing hook event only; a neutral event (an idle notification) does not advance that stamp.
- A stored `waiting` state from before 0.2.0 reads as Idle.

### Companies

- A session's company comes from its start folder (the folder it was started in, which does not follow `cd`). Nested known start folders group under the outermost one. The project is the start folder's sub-path below the company folder, and is empty when the session started at the company folder.
- Companies are worked out in the browser from per-Mac folder records plus the start folders of the sessions it has; a company key is the Mac plus the folder, so the same folder on two Macs is two companies with their own switches.
- The agent records each start folder once in a `folders` collection (`machineId`, `path`, `companyMode`); records have no expiry, so a Mac left off for a week keeps its switches, and a Mac with no machine record and no session stays hidden until it reports.
- The strip shows, per Mac, a tab for each company that has a live session or one that went home today (and always the viewed company), with four counts (Working including Thinking, Needs permission, Waiting for you, Idle) and a badge when sessions there need the owner (Needs permission or Waiting for you). An offline Mac is greyed: counts shown, no badge.
- Counts cover the whole company, never the tag filter and never went-home sessions.
- A company tab filters the office, the went-home list and the phone card strip to that company; a Mac's sessions never share a company with another Mac's.
- The office opens on the company last picked in this browser (kept in `localStorage`) while that company is still active; otherwise on the first company by name that has a live session, scanning online Macs in name order; otherwise a live "Other"; otherwise the first company by name on an online Mac, then on any Mac. "Other" is the default only when it is the only company.
- A refused company-mode request puts the pick back if the owner has not chosen anything since.
- Two companies on one Mac with the same folder name show `parent/name`.

### The drawer

- The strip's "All companies" button opens a drawer (a full-width sheet on a phone) above the office and the details panel; it closes on a pick or Escape.
- It lists every Mac and every company with the same four counts and the same needs-you badge, offline Macs greyed, and "N elsewhere need you" (needs permission plus waiting for you in other companies on online Macs), hidden at zero.
- A company's row has a company-mode switch (see below). Picking a row selects that company.

### Company mode and Other

- The owner switches company mode off on a company in the drawer; its direct child folders (at any depth, by path segment) then become companies for every viewer on its next poll, and its own sessions go to Other. Switching it back on restores the grouping. A switch only matters while the folder is a company; the stored flag is kept.
- The switch is one owner-only request, `POST /api/office/folders/company-mode` (401 for anyone else, 400 for a bad body), which upserts the folder record; a failed request reverts the switch and shows an alert line in the drawer, and a confirmed one stays pending until a poll agrees.
- Each Mac has one "Other" company, listed last on that Mac. It appears when a session sits in it or the Mac has a switched-off folder, and it shows only in the strip while a session is in it or went home from it today. In Other a session's project is its start-folder name.
- Switched-off folders stay in the drawer as dimmed rows "in Other" with their switch.

### Sideways phone

- On a short screen (`(orientation: landscape) and (max-height: 500px)`) the company strip folds into one compact button that opens the drawer, so the office keeps its size. Its badge counts sessions needing the owner across all companies on online Macs. A window taller than 500 px (an iPad, or a 700x800 window) keeps the full strip.
- On the same short screens the details sheet scrolls as a whole, so the recent steps keep their natural height, and the "Recent steps" heading is hidden.

### Repo tags and the tag filter

- Each employee shows the repos it worked in as tags. A tag is the repo's main checkout: a worktree counts as its main repo (read with `git --git-common-dir`), and the repo that is or wraps the start folder never counts, including a nested separate repo inside a bigger one. Subagent work adds tags. A deleted folder keeps its tag, and a write into a folder that does not exist yet is looked up in its nearest existing ancestor.
- The agent resolves tags with git (3 s timeout, 4 at a time, up to 2000 folders cached, a "not a repo" answer remembered for 30 s); a timeout or spawn failure is never cached as a miss. Only `{name, key, parent}` leaves the Mac: the folder name, a 12-character sha256 prefix of the main repo's path, and its parent folder's name.
- Same-named tags in one company are told apart as `parent/name` (for example `personal/api`); when the parent is missing or does not tell them apart, `name~` plus the start of the key is used. One rule serves the chips, employee labels and the details card.
- Inside a company a filter on the strip's line (inside the drawer on a sideways phone) offers All, each tag with its count (most sessions first, then name) and No tag. A session shows under every tag it has. The filter narrows the office employees only, not the went-home list or the company counts.
- It is hidden when the company has no tags. A tag that vanished, or an empty No tag, falls back to All, and a company switch resets it to All.

### Every session, every Mac

- Sessions from all set-up Macs appear in one office, each labelled with the Mac's computer name; the folder follows `cd` for the details card and ignores subagents' folders.
- Only interactive sessions are shown; runs started with an `sdk-` entrypoint (`claude -p` and Agent SDK programs) are not, and neither is a session whose process command line has `-p` or `--print` before any `--` (a `claude -p` started inside a VS Code session inherits its `claude-vscode` entrypoint); command lines come from the single process-table read of each 5-second pass, and a hook between passes reads one cached lookup for that session's own entries (a gone process is not looked up again for 10 seconds); a hidden run that resumes a conversation the office shows neither brings its desk back nor changes its name, folder or Remote Control link; a session with no registry entry yet is held until one appears and is dropped after 10 quiet minutes if it never becomes interactive.
- A session that is already running when the agent starts is picked up from `~/.claude/sessions` and its transcript.
- `/clear` ends the old employee and a new one arrives; in a window the office opened, the kept mark moves to the new conversation instead, and the old one goes home normally. A switch while the agent is stopped leaves the old desk "Not running" and the new one plain.
- The registry can list a session more than once (a resume leaves the old process's entry); the session counts as running while any of its entries is live.
- Sessions that never got a prompt are left out of the Went home list.

### Desk name

- The desk shows, in order: the AI-Kanban card summary, the card title, a Haiku name for a paste-only first message, the first real user message cut to 60 characters, the session's own name. When the first message is only a paste, the "Pasted text" placeholder goes after the session's own name, so the owner's `/rename` beats it.
- Slash commands, `!` bash-mode input and interrupt notices are not used as the first message.
- A message that starts with a `<tag …>…</tag>` block (any tag name) has that block removed, repeatedly, and the rest is used; if nothing is left the message is skipped and the next one is tried.
- A card created, renamed or removed later updates the desk; a name given with `/rename` later is picked up.

### The paste tag and Haiku desk names

- The paste tag (`<pasted_content …>`) is never shown on a desk, wherever it sits in the message. Typed words around a paste name the desk. A message that is only a paste shows "Pasted text". The hook strips paste blocks before it cuts the prompt to 500 characters, so typed words after a long paste are kept.
- When the first message is only a paste and the owner set an Anthropic key in the agent's config, the agent asks Haiku (`claude-haiku-5-5`, plain `fetch`, no SDK) for a short name (at most 6 words) from the first 500 characters of the paste.
- One call per session: the answer or a final failure is cached in `~/.claude-office/pasted-names.json` (mode 0600, newest 500 kept), so a restart does not ask again. No call when there is no key, when typed words or a card name already cover the desk, when the first message is held, or when the session already went home.
- A network error, 5xx or 429 is retried once after 30 s; other 4xx, a refusal and an empty answer are final and cached as "Pasted text". A 401 or 403 (bad key) is not cached, so a corrected key and an agent restart name the session.
- The call never delays the agent: the hook listener opens before any pending call finishes. The key, headers and pasted text are never logged.

### Steps

- The details card shows a "Recent steps" list, newest first, of finished steps; each step is one line (full text on hover) with its duration on the right; failed and stopped steps are muted. The running step is shown in the card's terminal box above, not in the list.
- "More steps" sits below the list and pages back up to a week; a session with no finished steps says "No finished steps yet".
- Step text: Read/Edit/Write show the verb and file name; Bash shows its description, else "Bash"; Agent shows "Agent: <description>"; Grep/Glob show "Search '<pattern>'"; WebSearch shows the query; WebFetch shows the domain; any other tool shows its name. A Bash or Agent step started in the background ends with "(started in background)". Text is cut at 120 characters.
- The to-do tool is not a step; it sets the desk's current to-do line.
- Failed, denied and stopped steps are marked; an API-error turn end adds one "API error" step.
- Durations are never shown below zero; steps older than a week are hidden.
- A subagent's own tool events are skipped; the parent shows one "Agent: ..." step.

### The details card

- **State band:** the state in the room's colour, then how long the session has been in that state, for example `WORKING · 3m 12s` (only the state word is uppercased). Thinking keeps its own word "THINKING" in the Working colour. The needs-permission band reads "NEEDS YOU". Went home shows "Went home" in grey with the time since it went home; a Mac that is offline shows a grey "Mac offline" with no time.
- **Time in state:** the agent stamps `stateSince` when the room the session is in changes, so a flip between Working and Thinking keeps the time running. After an agent restart the stamp comes from the registry's `statusUpdatedAt`, else the stored stamp when the room is unchanged, else now. The browser counts from the server's clock (`serverNow` on every changes answer), clamps below zero, and the format is `45s`, `3m 12s`, `1h 05m`, `2d 3h`. Rows from before the stamp show no time.
- **Project and tags:** the project (when there is one) and up to three `#tag` chips, then `+N`.
- **Terminal box:** Working shows the running step and its time, or "working…"; Thinking "thinking…"; Waiting for you "waiting for your reply"; Idle the last finished step, or no box. Needs permission shows "Wants to run" and, only when exactly one step is running, its text. The folder line and the current to-do stay; the box is hidden for an offline Mac.
- **Remote Control button:** "Approve in Remote Control" on a needs-permission session whose Mac is online, "Open Remote Control" otherwise (also on a Mac-offline card), absent for a went-home session. Details of the link are under Remote Control.
- **Footer:** the Mac name and the folder with the home folder as `~` and long paths cut in the middle (full path on hover).
- The sheet is a bottom sheet on a phone (at most 80% of the height); on a desktop only the steps list scrolls, and on a short screen the whole sheet scrolls.

### Went home

- A closed session leaves the office and appears in "Went home today", newest first, with desk name, Mac, folder and time; the list follows the selected company.
- "Today" is the browser's local day.
- Clicking an entry opens details with steps but no Remote Control link, and a Wake button.
- A resumed session returns to the office.
- **Waking:** Wake appears in the details card of a went-home employee (only today's list leads to one) and of a kept employee that is not running; it is absent for a running, waiting or starting employee, and disabled for an offline Mac, for an agent older than 0.3.0 (the card says to update it) and while its order is pending. One click sends one order. The card warns "will wait at the Mac for you to trust this folder" when the start folder's `cliTrusted` is false, and shows the order's outcome while that employee is selected ("Waking…", "Not woken: open elsewhere", other failure reasons, "Not sent"); selecting another employee and back shows the same outcome.
- The office route accepts a row that reads went home or not running; the agent is the real gate. It refuses, ending the order failed and opening nothing, when any registry entry with that session id, of any kind (a hidden `claude -p` run included), has a live process (`openElsewhere`); when a launch for that session is still waiting or starting (`openElsewhere`); when the registry or the process table cannot be read (`cannotCheckOpen`, "the Mac could not check whether it is open elsewhere. Try again."); when the start folder is gone (`folderMissing`) or the transcript is gone (`conversationNotFound`). The agent resumes in the start folder it stored for that conversation, never the folder an order carries, and a conversation it has no stored row for ends `conversationNotFound`; a session id that is not a UUID ends `invalidOrder` ("Not woken: the Mac refused the order as not valid."). The agent runs one poll at a time, reads everything it needs before the window opens and marks the session launching before its first await, so two wake orders for one session never open two windows. The route also refuses a wake (409 "a wake for this employee is already on its way") while a wake order for that session is claimed or pending within the 30 s pickup window. Checking and opening are not one atomic step, so a window opened by hand in the same instant can slip through. A row may still read went home while a refusal says the conversation is open elsewhere.
- A wake opens a Terminal window running `claude --resume <id> --remote-control` in the folder the session started in. The desk comes back at once, kept as `woken`, keeping its stored name, "waiting at the Mac" or "starting" by that folder's trust, and becomes a normal desk with the same Remote Control link once Claude Code registers the session. It stays until its window closes ("Not running"). Wake works the same after an agent restart.
- A session whose process died, or whose pid now belongs to another session, goes home; a session found already dead when the agent starts is dated no later than the Mac's last heartbeat.

### Hiring

- The Hire button sits in the company strip. Its dialog opens on the viewed company's Mac and folder and asks for a Mac, one of that Mac's known folders and a first message. The message is sent verbatim, leading spaces and indentation included; a blank one is refused, and one over 100,000 characters is refused with a 400 ("message too long") that the dialog turns into a plain sentence.
- Only folders the Mac has already shown the office, and that still exist there, are listed; the agent checks existence at start and every heartbeat.
- A Mac that is offline or has no record counts as offline; one whose agent is older than 0.3.0 or reports no version is greyed with "update this Mac's agent". Neither can be picked, and the server refuses them with a 409.
- Submitting writes one order to the `commands` collection. The agent polls every second, claims its own Mac's fresh orders by the database clock, erases the message from the order, and opens a Terminal window running `claude --remote-control --session-id <id>` in the folder with the message as its first prompt.
- The script file holds no message text: the message sits in a private file next to it that the script deletes as soon as it has read it, and both files are deleted once a registry entry with a live process has the session's id (the dead entry a woken session still has does not count). While Claude runs, the first message is an argument of its process, so `ps` shows it to anyone logged in to that Mac.
- The agent checks every order right after claiming it against one schema per kind (a UUID session id; for a hire also an absolute folder and a non-blank message within the length limit). A row that fails ends failed with `invalidOrder` ("The Mac refused the order as not valid.") and nothing runs, and the claim only takes kinds the agent knows. A hire also goes only into a folder on the Mac's own folder list (`folders` collection); any other folder ends the order `invalidOrder` even when it exists. The session id is quoted in the script, and launch file names are built only from a UUID.
- The employee's desk appears as soon as the window opens, in the folder's company, marked kept (`hired`), named from the first message by the usual 60-character rule; a kept session is never dropped for waiting too long for its registry entry. Until Claude Code registers the session it is "waiting at the Mac" (state needs permission, so it sits in the Needs permission room and counts toward the company's "needs you" badge) when the folder is untrusted or the Mac cannot tell, and "starting" (idle) when the folder is trusted. Both are published from the agent's own launch record, survive an agent restart, and clear when the registry entry with that session id appears; with an unreadable registry, the window's SessionStart or first-prompt hook clears them instead (a woken desk counts only a hook newer than its window opened). A window that registers nothing and sends no hook for 30 minutes after it opened (the owner answered "No, exit", or the script was lost) shows "Not running" instead, so Wake is allowed; if its registry entry or a hook appears later the desk goes back to running. The 30 minutes count from when the window opened, also across an agent restart.
- The agent reports each known folder's trust, read-only from `~/.claude.json` (`projects[<path>].hasTrustDialogAccepted`), at start and every heartbeat, and the office receives it as `cliTrusted`. The rule is what was observed, not documented: the nearest recorded answer at the folder or a parent wins, the walk stops at the git root (a `.git` folder or file, so a worktree is its own root), a folder with no git root above it walks up to `/`, and the real path is looked up before the path as typed. A missing, unparsable or project-less file leaves trust unset on every folder and the office shows no warning (the agent logs one line, never the file's contents). The agent never writes `~/.claude.json`.
- The hire dialog warns "will wait at the Mac for you to trust this folder" when the chosen folder has `cliTrusted === false`. Trust refreshes every 60 seconds, so the dialog may still warn for up to a minute after the owner trusted the folder at the Mac.
- The form scrolls inside the dialog on a short screen (a phone turned sideways, the keyboard up), so the Hire button stays reachable. The dialog stays open and locked from the click until the order resolves, and sends one order however often the button is pressed. It shows the reason when the order fails (folder missing, Claude Code not found, the window could not open, the agent restarted before the window opened). The Terminal opener gets 30 seconds; past that the order fails as "the window could not open" and the agent goes on to the next order. Wake and Dismiss word an interrupted order for what they do ("Not woken: ... before the window opened", "Not dismissed: the Mac's agent restarted first"). "Not sent" appears only when the office reports the order unclaimed after 30 seconds by the database clock (or no longer known), after which nothing runs later. After 35 seconds without an answer from the office it says the office lost contact and that the Mac may still run the hire. An order still claimed 2 minutes after it was given stops the polling and tells the owner to check the Mac. It closes itself when the window opened.
- An order the agent claimed but never finished when it restarts is marked failed `interrupted`; nothing opens late.
- When a hired employee's Terminal window closes (its process ends, or its end hook fires) the desk stays: idle, marked not running since the closing time, with no running steps, no Remote Control link and no went-home time; it counts as Idle and never enters Went home. The agent restores such desks, with their names, when it restarts; a restart that cannot read the registry leaves a desk as running until the registry can be read, and a live registry entry of another process (the conversation resumed elsewhere) brings a Not running desk back to running, with no old Remote Control link. The details card says "Not running" and shows no Remote Control line or terminal box; the desk itself gains no text.
- The details card of a waiting or starting hire says "Waiting at the Mac" (with what to do there: trust the folder, then click the window before typing) or "Starting" (with "Starting on the Mac."), shows no Remote Control line, link or terminal box, and outranks "Mac offline"; "Went home" and "Not running" outrank it. The desk itself gains no text.
- There is no Hire button on a sideways phone, where the strip folds into one button.

### Dismissing

- Dismiss appears in the details card of a kept (hired or woken) employee in any state: running, not running, waiting at the Mac or starting. It is absent for other employees and the desk gains nothing. It is disabled for an offline Mac, for an agent older than 0.3.0 (the card says to update it) and while its order is pending; one click sends one order. The card shows the order's outcome while that employee is selected ("Dismissing…", "Not dismissed: ...", "Not sent"), and selecting another employee and back shows the same outcome.
- Dismiss never ends the running process and never closes the window: the office never kills a Claude Code conversation, so the owner closes the window. It only stops keeping the desk at its place, by the agent clearing the kept mark through the tracker.
- A not-running, waiting or starting desk goes home at once, dated at the dismiss, so it tops today's went-home list and can be woken from there; the row is written at once, not left for a restart. A hire that never started (it had no prompt) leaves no went-home entry. Its launch script and message files are deleted and the order never held the message.
- A waiting or starting desk whose window has already started (its registry entry is live) is treated as running: it stays and is only unheld, even if the agent has not yet noticed the entry.
- A running desk keeps going as a normal desk without the mark and goes home at its real end time when its window closes. A window that registers after its wait was dismissed shows as a normal desk, and its first hook is not dropped.
- A dismiss order whose session id is not a UUID ends failed (`invalidOrder`) and changes nothing.
- Dismissing an id that is no longer kept ends the order done. A dismissed waiting desk can be woken again: clearing the wait is what lets the wake pass the "still launching" check.
- A kept desk of a Mac that is offline for good cannot be dismissed and clears 7 days after the Mac was last seen, with the session expiry.
- `/clear` or `/resume` in an office-started window moves the kept mark to the new conversation, so a dismiss then applies to the new desk.

### Remote Control

- The details card shows an "Open Remote Control" button linking to `https://claude.ai/code/<bridgeSessionId>` in a new tab (ids containing `/`, `?` or `#` give no link), or a muted "Remote Control off".
- The session registry's `bridgeSessionId` is the source of truth: it is read at start and on every registry check; a hook event that carries the id may set it, but a hook event without it never clears it; the id is cleared only when the registry entry exists and has none.
- Clicking never navigates by itself; the link lives only in the card.

### Staying right when hooks miss things

- The agent re-reads the session registry about every 5 seconds: a dead or reused process goes home, a fresher registry status corrects a stale state, and a changed registry folder updates the start folder. A process counts as the same one when its `ps` start time, read in UTC, equals the registry's `procStart` (Claude Code writes it in UTC).
- A session may have several registry entries and counts as running while any of them is live; a wake is refused while any is live.
- If the registry is unreadable or its format changed, the agent runs on hook events alone and sends nothing home.
- Late or out-of-order events do not move a session backwards; writes per session are serialized and steps are deduplicated by id.
- When the database is unreachable, the agent queues a bounded number of writes and catches up.
- Each Mac writes a heartbeat about every 60 seconds; after about 3 minutes without one the office greys that Mac's characters and labels the details "Mac offline".
- If `ps` fails at agent start-up, the agent refuses to start and launchd retries.

### Live updates

- The office page polls for changes about every 3 seconds only while the tab is visible, checks at once when the tab returns, and backs off on failures.
- It shows "Updated N min ago" and a "Connection lost" banner when polling fails; on a 401 it stops and sends the owner to sign-in.
- The changes API returns what changed since the browser's cursor, with a 5-second overlap, plus every folder record and the server's clock; the browser merges sessions by (machine, session).

### Phone

- The office fits the screen, can be panned and pinch-zoomed, shows a select-only strip of employee cards, and the went-home list is a sheet. The company strip, drawer and details sheet follow the rules above, including the sideways layout.
- Tapping an employee or card opens the details card as a bottom sheet.

### Connecting a Mac

- `npm run setup` asks the office for a connect request named after the Mac and prints a link and an 8-character code.
- `/connect` shows the Mac name and the same code; only the signed-in owner can click "Connect this Mac".
- The Mac collects the database connection once; codes live 10 minutes; at most 5 unexpired codes exist at a time.
- Running setup again skips connecting when a valid saved config exists, and keeps an Anthropic key the owner added to it; `npm run setup -- --reconnect` forces a new approval.

### Hooks and agent install

- Setup adds one async command hook for each of 13 events to `~/.claude/settings.json`, next to existing hooks, backs the original up once, and changes nothing on a second run. Hooks run the script through the link `~/.claude/claude-office` to the repo checkout, so updating the checkout updates the hook; running setup again re-points the link if the checkout moved. A hook older than 0.2.0 sends no answer text, so finished turns show as Idle.
- The hook always exits 0, prints nothing, hands the event to the local agent and returns; it has a hard exit timer so a hung agent cannot slow Claude.
- The agent starts at login as a launchd LaunchAgent and restarts if it stops; it also exits by itself after about 5 minutes without a successful database write so launchd starts a fresh one. A long gap between checks is read as a Mac sleep and gets a fresh limit.

### Repo front page

- A visitor to the GitHub repo sees a centred title and description, badges (checks, licence, Node 24+, macOS agent), a walking-office GIF, desktop, phone and details-card screenshots, a features list, a quick start, how it works, what never leaves the Mac, an FAQ, requirements, deploy and Mac setup steps, and a link to CONTRIBUTING.
- The public version is 0.3.0 in `package.json` and in all public text; there is no release.
- A GitHub Actions workflow runs lint, type-check and the unit tests on pushes to `main` and on pull requests (not for Markdown-only changes); it does not run the end-to-end tests. Bug reports use an issue form.
- `npm run capture` rebuilds the README images (including a 1280x640 social preview) from a local Playwright run of a seeded office.
- A unit test checks the image sizes, README links and anchors, the workflow and issue-form YAML, and the version.

## Privacy guarantees

- The text of a shell command never leaves the Mac: the hook keeps only an allowlist of `tool_input` keys, and the agent's schema drops anything else again.
- Tool output, error text and notification text are never stored.
- The end of the assistant's last answer and the first part of a paste-only message reach only the local agent; they are never stored or published. The one exception is the optional Haiku call, which sends up to 500 characters of a paste-only first message to Anthropic and only when the owner set a key.
- Free text that is stored: the first message (60 characters), the Haiku desk name, Bash and Agent descriptions, search patterns, web queries and domains, file names, the session's name and folder paths.
- The folder of each step (`file_dir`) stays on the Mac; only each repo tag's name, key and parent folder name are stored and sent.
- The agent's config, address and desk-name cache files are created readable only by the user.
- The first message of a hire passes through the database: the agent erases it from the order when it claims the order, and an order no Mac claims is deleted with its message after about 10 minutes. On the Mac it lives in a file readable only by the user, which the window's script deletes as soon as it has read it (and which is deleted too if the window could not open, on dismiss, or at the next agent start).

## How the pieces fit

- **Hook:** `hooks/claude-office-hook.mjs` reduces each event and posts it to the loopback agent found through `~/.claude-office/agent.json`.
- **Agent:** TypeScript run with `node --import tsx` under `agent/`; tracks sessions, steps, desk names, start folders, repo tags, the time in each state and the heartbeat, and writes to MongoDB only when something changes.
- **Database:** the `claude-office` database; sessions carry their last 5 steps, full steps live in their own collection, folder records in `folders`, hire orders in `commands`; every write stamps `changedAt` with the server's clock.
- **Web app:** Next.js with better-auth (Google); the office page loads once, then polls the changes API. Companies, projects and the strip, drawer and tag filter are computed in the browser.
- **Renderer:** pixel-agents v1.5.0 (commit b1bafd0, MIT) copied into `src/office/` with its licence and credits; characters credit JIK-A-4 MetroCity (CC0).
- **Shared code:** `src/shared/` holds the schemas, step text, desk-name, asks, company, overview and tag rules used by both sides.

## Timings and limits

- Poll about 3 s while visible; changes overlap 5 s; registry check about 5 s; heartbeat about 60 s; Mac offline after about 3 min.
- Agent self-exit after about 5 min without a database write; held-session eviction after 10 min; a waiting or starting desk shows Not running after 30 min without a registry entry or hook.
- Steps, sessions and Mac records expire 7 days after last seen; the agent renews open sessions at most daily. Folder records do not expire.
- Hire orders: the agent polls every 1 s and picks up an order created within the last 30 s; the Terminal opener gets 30 s before the order fails; the dialog polls every 2 s, reports lost contact after 35 s without an answer and "check the Mac" for an order claimed over 2 min ago; an unclaimed order expires after 10 min, a claimed one after 1 day; the folder-existence and trust refresh runs at start and every 60 s.
- Connect code life 10 min; at most 5 open codes.
- Steps API pages default to 50, at most 200.
- Haiku: 10 s per request, one retry after 30 s, 500 cached answers.
- Repo lookup: 3 s per git call, 4 at once, 2000 folders cached.

## Setting up a Mac

- The owner clones the repo and tells Claude to follow `SETUP.md`.
- It checks Node 24+, runs `npm install`, runs `npm run setup` (connect, hooks, LaunchAgent) and gives checks for each step.
- Optional: an `anthropicApiKey` in `~/.claude-office/config.json` turns on Haiku desk names for paste-only sessions.
- Removal is by hand and documented in `SETUP.md`; there is no uninstall command.
- Macs only; Windows is out of scope.

## Deployment

- The web app runs on any Node host (Vercel works) with a MongoDB database and a Google OAuth client; the environment variables and redirect URIs are in `README.md`, and `.env.example` lists them.
- The allowed Google account is an environment setting of the host.
- Running locally needs the redirect `http://localhost:3000/api/auth/callback/google` and `BETTER_AUTH_URL=http://localhost:3000`.

## Decisions worth knowing

- **Machines write straight to the database:** the one-click connect hands the Mac its connection string; the owner rejected an extra API layer.
- **Hook to agent:** an async command hook posting to loopback, not an http hook, so a stopped agent never shows a hook error.
- **Change cursor:** server-clock `changedAt`, because Mac clocks differ and Vercel cannot hold a change stream.
- **Connect page shows Mac name and code:** a public create route could otherwise be used to phish a connection string through a crafted link.
- **Clicks open a panel:** no accidental navigation, the same on desktop and phone.
- **Subagents:** one "Agent: ..." step on the parent, no extra character; their work still adds tags.
- **Went home end time:** stamped once by the agent, so later re-writes of an ended session do not move it.
- **Visible 5 steps:** the latest-started steps, so parallel tools leave no gaps.
- **Offline Mac:** characters are greyed, not just the label.
- **No restart after sleep:** the write watchdog does not restart the agent merely because the Mac slept.
- **Four rooms, not five:** Working and Thinking share one room, because employees kept walking between the two during busy turns; the `thinking` state stays for the card's band and terminal box. Waiting for you is its own state (not a flag on Idle) so every exhaustive map flags a missed branch.
- **The asked-the-owner rule runs in the agent:** one TypeScript rule serves the live Stop and the transcript seed, rather than a copy in the hook; a false needs-you badge is judged worse than a missed one.
- **Company from the start folder:** the rule "most steps plus also in" picked arbitrary projects, so the company is the start folder and the repos touched became tags.
- **Companies computed in the browser:** a company-mode switch then needs no Mac to republish its sessions; only tags need git, so those are resolved on the Mac.
- **Folder records in their own collection:** a Mac's machine record expires after 7 days and would drop its switches.
- **Default company:** the last pick in this browser, else the first company with live work, so the office never opens empty while an online Mac has live work.
- **Tag key is an unsalted hash:** working folders already reach the web, so salting hides nothing new.
- **Same-named repo tags show `parent/name`:** chosen over a cryptic key prefix; the parent folder's name reveals nothing new.
- **A bad Haiku key is not cached:** fixing a mistyped key and restarting names sessions that failed before.
- **Sideways phone sheet scrolls as a whole:** the steps would otherwise shrink to nothing behind "More steps".
- **Version 0.3.0, no release:** a larger version number would overstate how finished the app is.
- **Mutation survivors:** survivors get tests unless they change no visible behavior.
- **Hook install stays in this repo;** moving it to AI-rules is later work.

## Accepted limits

- A database outage longer than about 5 minutes loses the steps queued during it.
- A stranger can fill the connect-code cap and block connecting for up to 10 minutes.
- Which hook fires after a manual "No" on a permission dialog is not verified, and whether already-open sessions pick up newly installed hooks is not verified; both are manual checks.
- The assumption that `/clear` keeps the process id is unchecked; the rule built on it is harmless if wrong.
- A registry check that lands between a busy flip and the follow-up Stop can drop a remembered question; the result is a missed badge, which is preferred over a false one.
- Phones narrower than about 544 CSS px at 2x (360 px at 3x) see the office at zoom 1.
- Folder records ride on every changes answer, so many throwaway folders make the answer grow.
- The tag key is a hash of a guessable path; it hides nothing the start folders do not already show.
- A desk-name request that failed for good (not a bad key) keeps "Pasted text" and is not asked again.
- The art's original source is not stated by the Pixel Agents repo it was copied from.
- The first GitHub Actions run, and with it the checks badge, is unproven until the next push.

## Not built yet

- Non-interactive sessions (`claude -p`, scheduled prompts, Agent SDK runs).
- Messaging sessions, auto-wake, waking departures older than today, stop buttons, controlled updates, teams, push notifications, one-line summaries, per-session cost.
- A session inspector.
- Desk clusters by project inside a room; seats fill in order today.
- An uninstall command.

## Open items

- Each Mac's agent must be updated to 0.3.0 before it can take orders; until then the office greys out hiring for it.
- Follow `SETUP.md` on the owner's Mac and confirm a live session shows at the deployed office from the Mac and a phone; then pull the new version on each Mac and restart its agent (`launchctl kickstart -k gui/$(id -u)/dev.quanvo.claude-office.agent`); the hooks follow the checkout through the `~/.claude/claude-office` link.
- Turn on private vulnerability reporting in the GitHub repo settings.
- Check the first GitHub Actions run after the push; the workflow was not run on GitHub.
- Check the host plan's function-call allowance against about 1,200 polls per hour per visible tab.
- Note for later: the claude-usage tool's repo-name backfill is out of scope here.

## Key files

- `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/require-owner.ts`: sign-in gate; `src/lib/require-online-mac.ts`: refuses orders for a Mac that cannot take them.
- `src/office/` (`sceneSync.ts`, `rooms.ts`, `offline.ts`, `wentHome.ts`, `remoteControl.ts`, `engine/`, `components/`, `hooks/useIsSidewaysPhone.ts`): office rendering and scene sync.
- `src/app/office/`: office page (`OfficeView.tsx`), `CompanyStrip.tsx`, `CompanyDrawer.tsx`, `TagFilter.tsx`, `HireDialog.tsx`, `WakeControl.tsx`, `DismissControl.tsx`, `useOrderStatus.ts`, `RoomSigns.tsx`, `DetailsPanel.tsx`, `StepsList.tsx`, `elapsed.ts`, went-home list, polling hook, connection status.
- `src/app/api/office/changes`, `src/app/api/office/steps`, `src/app/api/office/folders/company-mode`, `src/app/api/office/hire`, `src/app/api/office/wake`, `src/app/api/office/dismiss`, `src/app/api/office/commands/[id]`, `src/app/api/connect/`: office and connect APIs.
- `src/shared/`: commands, session, session-state, hook-event, step-text, desk-name, asks, folders, companies, overview, tag-labels, tag-filter and connect schemas and rules.
- `hooks/claude-office-hook.mjs`: the hook.
- `agent/`: `session-state.ts`, `tracker.ts`, `steps.ts`, `writer.ts`, `reconcile.ts`, `transcript.ts`, `folders.ts`, `trust.ts`, `repo-resolver.ts`, `paste-namer.ts`, `commands.ts`, `terminal-launch.ts`, `kept.ts`, `config.ts`, `heartbeat.ts`, `write-watchdog.ts`, `kanban-watch.ts`, `start-agent.ts`, `main.ts`.
- `agent/setup/`: connect, hook install, launchd install.
- `scripts/generate-office-layout.ts` (`npm run layout`), `scripts/capture-readme-images.ts` (`npm run capture`), `public/assets/office-layout.json`.
- `README.md`, `CONTRIBUTING.md`, `SETUP.md`, `THIRD_PARTY_NOTICES.md`, `.github/`, `docs/images/`, `e2e/`.

## Quality record

- Version 0.1.0 was built as 17 behaviors; version 0.2.0 is 18 behaviors, one commit each on `main` after commit 0a05830.
- At the end of the 0.2.0 run: 330 unit tests, 53 of 53 Playwright specs, type-check and lint clean.
- Conformance check of the 18 behaviors: all 18 valid; the caveats were test gaps and the sideways sheet scroll, and were fixed.
- Seven quality gates ran after groups of behaviors; each found fixes that were folded into the owning commit and re-checked.
- Adversarial pass over a catalog of 57 risks: 48 survive, 0 break, 9 silent misbehaviors and 1 side finding; all were fixed except two accepted as they are (a busy-to-idle race between Stops, and zoom 1 on very narrow phones).
- Mutation pass: 30 mutants over the state logic, company tree, repo tags, paste rule, tag labels and the desk namer; 23 killed, 7 survived; six have killing tests and one (a freed paste head after a cached failure) is accepted as unobservable memory hygiene.
- The 0.1.0 record: 17 behaviors, 177 unit tests and 21 Playwright specs at the end, a mutation pass of 28 mutants with 24 killed and 4 survivors that got tests.
