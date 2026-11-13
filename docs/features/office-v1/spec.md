# Claude Office (version 0.4.0)

A pixel-art office web app that shows every interactive Claude Code session on every set-up Mac of the owner, viewable from a Mac browser or a phone, and lets the owner hire a new employee on an online Mac. Public repo `votrungquan1999/claude-office`, branch `main`, MIT licence.

This file is the living spec for the whole app (version 0.4.0); its folder is named `office-v1`.

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

- **Office view:** one pixel-art office, 34 by 22 tiles, with five labelled rooms: Working, Needs permission, Waiting for you, Review, Idle. A real phone shows the same five rooms stacked as lists instead (see [Phone](#phone)).
- **Employees:** each session is a character that sits in the room matching its state and moves when the state changes.
- **Labels:** an employee's label is `desk name · Mac / project`, or `Mac / company name` when the session started at its company folder, followed by its repo tags as `#name`. It is shown only while the mouse is over the employee or it is selected (tap or click); permission and waiting bubbles are always shown.
- **Companies:** the folders sessions start in group into companies. A bar above the office has a group per Mac with one tab per company, and an "All companies" button pinned at its right edge; a drawer lists every Mac and company, and is where a company is renamed.
- **Repo filter:** a floating "All repos" pill at the office's top-left narrows the office to the employees who worked in one repo.
- **Details:** clicking or tapping an employee opens a pixel card: a state band (with how long the session has been in that state, and the project and tags), the desk name, a terminal-style box for what it is doing or wants to run, the Remote Control button, the recent steps, and the Mac and folder. The card is 360px wide on a desktop and a bottom sheet on a phone, an iPad or a narrow window.
- **Went home:** closed sessions leave the office and appear in the list's folded "Went home today" section on a desktop, an iPad and a narrow window, and in a sheet opened from the bottom bar on a phone.
- **Sign-in:** Google only; one allowed account.
- **Machines:** each Mac runs a small background agent that reports to the shared database; the hosted app reads it.

## Behaviors

### Sign-in

- A signed-out visitor sees only the sign-in page; every page and office API checks the owner.
- Any Google account other than the allowed, verified email is refused, both when the user is created and when a session is created.
- Every page forbids being framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).

### Office and rooms

- The pixel office (desktop, iPad and narrow windows; a real phone shows [stacked rooms](#phone) instead) has five named rooms joined by doorways, 48 places in all: Working 24, Needs permission 7, Waiting for you 8, Review 3, Idle 6. Working (wide, left) and Needs permission are on top; Waiting for you, Review and Idle are below, left to right. Review has a purple sign and floor.
- Working: a tool is running, or the session is between steps (thinking); both live in the same room, so an employee does not walk between the two. After the turn ended, a background sub-agent that is still running also keeps the desk here (see [Waiting for you, Review or Idle](#waiting-for-you-review-or-idle)).
- Needs permission: a dialog waits for the owner. Other waits for the owner (questions, MCP forms) also go here. The room is a sign-off counter: a whiteboard on the wall with a "SIGN-OFF" label beside it, a counter with a paper on it and the owner's empty chair behind it. Seven standing places in one line along the counter's front row, east of it, fill from the counter outwards; each employee holds a paper, faces the counter and shows a red "!" bubble over its head (a different picture than the "…" of Waiting for you), and stays put. The paper lies on the counter's front row. Employees beyond seven stand still on the lower part of the floor, away from the wall.
- Waiting for you: the turn ended and the last answer asked the owner something. Its room is a waiting area: eight benches in two rows face a clock on the wall, a door hangs on the north wall, and each employee sits on a bench with a "…" bubble over its head until it leaves Waiting for you. A ninth stands still on the lower part of the floor.
- Review: the turn ended with a result to look at (any answer text that does not ask). It has its own purple Review room, a gallery: paintings of finished work on the wall, a table with a mug on its front row, and three places that fill in this order: one employee stands on the floor beside the paintings, facing the viewer, then two sit at the table. Employees there are calm (not busy), stay put, and show a checkmark bubble until the owner moves them to Idle; a fourth and later ones stand still on the lower part of the floor. The owner clears it by hand: [Move to Idle](#moving-a-review-employee-to-idle).
- Idle: the turn ended with nothing to show (no answer text, an Esc, an error) or Haiku found nothing to look at. A session first seen after its turn ended with an unreadable transcript also shows Idle. The Idle room is a lounge with no desks or computers: three sofas (one faces a coffee table with two mugs), a coffee corner (a small table with a mug), two bookshelves on the wall and plants. Its six places fill in this order: sofa, a reader standing at the bookshelf holding a paper, sofa, a stander at the coffee corner, the facing sofa, a second stander. Idle employees still wander inside the room.
- Several open dialogs keep the employee in Needs permission until the last one is answered.
- A dialog raised by a subagent moves the parent session to Needs permission.
- When the session's own status reports it busy again after a dialog, the dialog counts as approved and the employee leaves Needs permission.
- A context compaction keeps the session's state.
- A room's places come from the layout: a room that lists its own places (`spots` in the layout, each with a pose, a facing and whether the employee stands) gives its employees those places in list order, and a chair there is not a seat; other rooms keep every chair as a seat. A pose is `type` (typing animation, only at Working seats), `sit` (seated, the typing frame held still), `read` (holding a paper, seated or standing) or `stand` (the standing walk frame). A standing employee is drawn without the sitting offset, and one with no place stands on the floor of its room. A room named in the layout's `stayPutRooms` keeps its employees at their places: they do not get up or wander, though they still walk out when their state moves them to another room. Waiting for you, Needs permission and Review are stay-put; Working and Idle are not. Only Working has computers; outside it the one desk is the sign-off counter.
- An employee takes a free seat in its room; when the room is full it stands on the room's floor, never in a doorway and never in another room.
- Each room's sign shows its name; when a room holds more employees than seats it reads `Needs permission 14 / 8`. Signs scale with the zoom so they do not cover seats at small zooms.
- The busy look and the bubbles (a red "!" over Needs permission employees, "…" over Waiting for you employees and a checkmark over Review employees) change at once when the state changes; the walk to another room waits until the new state has held for 2 seconds, so a short flip does not send the employee walking.
- Every seated employee in the Working room faces a computer screen: the desk in front of an up-facing sitter holds a computer showing its screen side, and the lower row's computers face the down-facing sitters from the other side of their desk. The layout is generated (`npm run layout`), never hand-edited.
- An idle employee wanders only inside its own room, except in a stay-put room, where it does not wander.
- Each session keeps the same character look wherever the office is loaded.
- The camera zoom fits the space beside the list. At 1280x800 and pixel density 1 the 400 px list leaves the office 880 px, so the zoom there is 1 (at density 2 it stays higher). Below about 544 CSS px at 2x pixel density (360 px at 3x) the zoom falls to 1. A real phone does not draw the canvas, so its screen size no longer affects the zoom.

### Waiting for you, Review or Idle

- When a turn ends (the Stop hook), the agent sorts the last answer three ways: asks (Waiting for you), reports a result (Review) or nothing (Idle). The plain rule first decides whether it asked the owner something: it reads the last three non-empty lines with fenced code removed, and the answer asks when a line ends in `?` (a closing quote, bracket, `*` or `_` may follow) or a sentence starts with "tell me", "let me know", "say the word", "want me to", "should I", "do you want", or "which one / option / approach / of / do you / would you / should we". A bare "which" does not count.
- With an Anthropic key set, the agent also asks Haiku (`claude-haiku-5-5`, the same plain `fetch` client style as the task names) whether the last answer asks the owner to answer, choose, approve or provide something (ASKS), reports a result or finished work to look at (REPORTS), or leaves nothing to act on (NOTHING), with a one-word reply, from at most the last 1,000 characters of the answer. The desk is published at once with the rule's result, except that a plain answer shows Idle first so a turn with nothing to show never flashes Review; when Haiku answers it is corrected to Waiting for you (ASKS), Review (REPORTS) or Idle (NOTHING). Haiku's answer wins over the rule when both answered.
- The correction applies only while the session is still in that same ended turn: a newer prompt, Stop, restart of the session or registry status change discards a late answer.
- With no key, the rule decides: a question goes to Waiting for you, any other answer text to Review, no text to Idle. When the call fails, times out (10 s) or answers something else, the rule's result stands as with no key: a plain answer that showed Idle first goes to Review, so a broken key or an outage never hides finished work (an answer only Haiku reads as asking then shows Review, not Waiting for you). A follow-up Stop that a Stop hook started keeps the stronger result of the earlier Stop (asks, then reports, then nothing), whatever Haiku says about the follow-up. Answers are cached in memory per session and message, so the same tail is never sent twice; the registry-idle and restart paths use the same check on the transcript's last answer.
- The hook sends the agent the end of the answer (about the last 1000 characters, with a cut code fence dropped) and a `stop_hook_active` flag; the answer text is used for the decision and never stored.
- A follow-up turn that a Stop hook started keeps the stronger earlier result; a new prompt clears it.
- The state lasts until the owner answers; nothing times it out.
- A session already finished when the agent starts (or first seen later) gets the same decision from its transcript, unless an earlier run stored a finished state (Idle, Waiting for you or Review) for it: that state is kept, so conversations finished before this version first ran do not move into Review. A turn starts at the last user record that is not a tool result, not meta and not a compaction summary, whatever its origin, so a background-task turn after a question reads as Review (it ended on text without asking). An API-error record after the text ends the turn without a question. A transcript with only garbled lines is Idle.
- The registry's `idle` status ends a working or thinking turn; if the Stop was missed, the transcript tail decides Waiting for you, Review or Idle. A registry `idle` also clears a stale dialog.
- Registry timestamps are compared with the last state-changing hook event only; a neutral event (an idle notification) does not advance that stamp.
- A stored `waiting` state from before 0.2.0 reads as Idle.
- Sub-agents: each sub-agent is tracked from its first event (or SubagentStart) until its SubagentStop. After the parent's turn ended, a running sub-agent moves the desk back to Working until the last one stops; the desk then returns to the state the turn end decided (Waiting for you, Review or Idle). Only sub-agents a SubagentStart announced survive the turn end; ones seen only through tool events are dropped at Stop, so a missing SubagentStop hook cannot leave a desk working. A late event of a sub-agent that already stopped changes nothing, and a new prompt or a registry `idle` clears the running sub-agents. Sub-agent tools and dialogs after the turn ended change nothing else.
- Setups made before the SubagentStart and SubagentStop hooks were added need `npm run setup` again to register them.

### Companies

- A session's company comes from its start folder (the folder it was started in, which does not follow `cd`). Nested known start folders group under the outermost one. The project is the start folder's sub-path below the company folder, and is empty when the session started at the company folder.
- Companies are worked out in the browser from per-Mac folder records plus the start folders of the sessions it has; a company key is the Mac plus the folder, so the same folder on two Macs is two companies with their own switches and names.
- The agent records each start folder once in a `folders` collection (`machineId`, `path`, `companyMode`); records have no expiry, so a Mac left off for a week keeps its switches and names, and a Mac with no machine record and no session stays hidden until it reports. A record may also carry the owner's name for the company (`displayName`); the agent never writes it.
- The bar shows, per Mac, a group: the Mac's name with a fold toggle, then a tab for each company that has a live session or one that went home today (and always the viewed company). On a desktop, an iPad and a narrow window each tab has five counts (Working including Thinking, Needs permission, Waiting for you, Review, Idle) and a badge when sessions there need the owner (Needs permission, Waiting for you or Review). On a real phone a tab shows only the name and that badge. An offline Mac is greyed: counts shown, no badge.
- The browser tab title reads "(N) Claude Office" where N is every employee that needs the owner (Needs permission, Waiting for you, Review) in every company on an online Mac, the viewed company or not and whatever the repo filter hides; it is plain "Claude Office" at zero, so N equals the sum of the strip badges. Went home employees and those of an offline Mac never count.
- Tab names that do not fit are cut with "…" and the full name shows on hover; the drawer shows the full name, wrapped.
- Counts cover the whole company, never the repo filter and never went-home sessions.
- A company tab filters the office, the went-home list and the phone's stacked rooms to that company; a Mac's sessions never share a company with another Mac's. Pressing the company already viewed changes nothing, so the repo filter stays.
- Companies are ordered by the name shown (the owner's name when there is one), "Other" last on its Mac.
- The office opens on the company last picked in this browser (kept in `localStorage`) while that company is still active; otherwise on the first company by name that has a live session, scanning online Macs in name order; otherwise a live "Other"; otherwise the first company by name on an online Mac, then on any Mac. "Other" is the default only when it is the only company.
- A refused company-mode request puts the pick back if the owner has not chosen anything since.
- Two companies on one Mac with the same folder name show `parent/name`. A rename never changes another company's label: the suffix rule counts folder names only.

### The company bar

- The "All companies" button sits at the bar's right edge and stays there however many companies there are; only the tabs scroll. On a real phone it is a grid icon button labelled "All companies".
- A Mac's name in the bar is a fold toggle. Folding shows the Mac as one label, `Mac · N companies` (N counts the tabs hidden; with none hidden only the Mac's name shows), and hides its tabs except the viewed company's, which always stays visible.
- A folded Mac shows a needs-you badge beside its label that adds up Needs permission, Waiting for you and Review of the hidden companies, only for companies on an online Mac. New work on a folded Mac never unfolds it; the label and badge update on the next poll.
- Picking a company hidden by a fold (from the drawer) shows that company's tab and hides the one before; the Mac stays folded.
- Folded Macs are remembered per browser in `localStorage` (`claude-office.collapsed-macs`, a list of machine ids). Missing, unreadable or unavailable storage means every Mac is open; a Mac starts open; ids of unknown Macs are ignored.

### The drawer

- The bar's "All companies" button opens a drawer above the office: a 420 px panel on the right on a desktop, a full-width bottom sheet on a phone, an iPad or a narrow window. It closes on a pick, the × button or Escape. Opening it closes an open details card.
- It lists every Mac and every company with the same five counts and the same needs-you badge, offline Macs greyed, and "N elsewhere need you" (needs permission, waiting for you and review in other companies on online Macs), hidden at zero.
- A company's row has a pencil (see [Renaming a company](#renaming-a-company)) and a company-mode switch (see below). Picking a row selects that company.
- Opening All companies closes an open details card. On a desktop the companies drawer floats over the office, left of the list; the status line ("Updated N min ago", "Connection lost") moves to its left so the drawer never covers it.

### Renaming a company

- Each company row backed by a folder has a pencil in the drawer (on a desktop and on a phone) that opens a Name field with Save, Cancel and, once the company has a name of its own, "Use folder name". The field shows the company's shown name, and the row says `folder <name>` under a renamed company.
- On a desktop with a mouse, double-clicking a tab opens the same field inside the tab: Enter saves, Escape cancels, clicking away saves. Touch screens have no double-tap rename; they use the drawer pencil.
- Names are trimmed and at most 100 characters. A blank name, the folder's own name and "Use folder name" all put the folder name back. Saving a name that changes nothing, or a blank on a company that was never renamed, sends nothing.
- "Other" has no pencil and no name; switched-off folders have no pencil but show their custom name and the folder line. Companies of an offline Mac can be renamed.
- Only one editor is open in the drawer at a time; opening another pencil drops the first draft. Pencil, Save, Cancel and "Use folder name" never close the drawer, and Escape anywhere in the editor cancels the edit only.
- A name shows at once on the device that set it, then on every device on its next poll, in the bar, the drawer, employee labels and went-home rows; tabs re-sort by the new name. The server keeps the name per Mac and folder: `POST /api/office/folders/display-name` is owner-only (401 for anyone else, 400 for a bad body or a name over 100 characters), stores a non-blank name, removes the stored name for a blank or null one, and creates the folder record (company mode on) when a switch-off made a company folder with no record yet.
- If the server refuses (or the request fails), the old name comes back and "Could not rename. Try again." appears in the company's drawer row, or under the bar when the rename came from a tab or the drawer was closed before the refusal. The message stays until the next rename, until the owner switches company, or until the drawer opens. A refusal of an older request never undoes a newer rename, and a name a device sent gives way to a different name another device saved later.

### Company mode and Other

- The owner switches company mode off on a company in the drawer; its direct child folders (at any depth, by path segment) then become companies for every viewer on its next poll, and its own sessions go to Other. Switching it back on restores the grouping. A switch only matters while the folder is a company; the stored flag is kept.
- The switch is one owner-only request, `POST /api/office/folders/company-mode` (401 for anyone else, 400 for a bad body), which upserts the folder record; a failed request reverts the switch and shows an alert line in the drawer, and a confirmed one stays pending until a poll agrees.
- Each Mac has one "Other" company, listed last on that Mac. It appears when a session sits in it or the Mac has a switched-off folder, and it shows only in the bar while a session is in it or went home from it today. In Other a session's project is its start-folder name.
- Switched-off folders stay in the drawer as dimmed rows "in Other" with their switch.

### Repo tags and the repo filter

- Each employee shows the repos it worked in as tags. A tag is the repo's main checkout: a worktree counts as its main repo (read with `git --git-common-dir`), and the repo that is or wraps the start folder never counts, including a nested separate repo inside a bigger one. Subagent work adds tags. A deleted folder keeps its tag, and a write into a folder that does not exist yet is looked up in its nearest existing ancestor.
- The agent resolves tags with git (3 s timeout, 4 at a time, up to 2000 folders cached, a "not a repo" answer remembered for 30 s); a timeout or spawn failure is never cached as a miss. Only `{name, key, parent}` leaves the Mac: the folder name, a 12-character sha256 prefix of the main repo's path, and its parent folder's name.
- Same-named tags in one company are told apart as `parent/name` (for example `personal/api`); when the parent is missing or does not tell them apart, `name~` plus the start of the key is used. One rule serves the chips, employee labels and the details card.
- Inside a company a floating pill at the office's top-left reads `All repos N` (N is the company's employees). Pressing it opens a chip panel: a popover on a desktop, a bottom sheet with a Close button on a phone, an iPad or a narrow window. The panel offers All, each tag with its count (most sessions first, then name; for example `api 2`) and No tag (only when some employee has no tag). The pill is absent when the company has no tags. A session shows under every tag it has. Picking a chip closes the panel.
- While filtered the pill reads `#api 2 of 3` (or `No tag 1 of 3`) and has a × button ("Show all repos") that clears the filter. The panel also closes on Escape, on a press outside it, and when a drawer or the details card opens.
- The filter narrows the office employees (the stacked rooms on a phone) only, not the went-home list or the company counts.
- It is hidden when the company has no tags. A tag that vanished, or an empty No tag, falls back to All, and a company switch resets it to All.
- On a desktop, iPad and narrow window the pill stays pressable while a details card is open; the desktop card opens below the pill's spot whether or not the pill is shown. On a phone the pill sits in a row above the stacked rooms and stays there while they scroll.

### Every session, every Mac

- Sessions from all set-up Macs appear in one office, each labelled with the Mac's computer name; the folder follows `cd` for the details card and ignores subagents' folders.
- Only interactive sessions are shown; runs started with an `sdk-` entrypoint (`claude -p` and Agent SDK programs) are not, and neither is a session whose process command line has `-p` or `--print` before any `--` (a `claude -p` started inside a VS Code session inherits its `claude-vscode` entrypoint); command lines come from the process-table read inside each 5-second reconcile pass (a second read in the same tick only decides which launch files to delete), and a hook between passes reads one cached lookup for that session's own entries (a gone process is not looked up again for 10 seconds); a hidden run that resumes a conversation the office shows neither brings its desk back nor changes its name, folder or Remote Control link; a session with no registry entry yet is held until one appears and is dropped after 10 quiet minutes if it never becomes interactive.
- A session that is already running when the agent starts is picked up from `~/.claude/sessions` and its transcript.
- `/clear` ends the old employee and a new one arrives; in a window the office opened, the kept mark moves to the new conversation instead, and the old one goes home normally. A switch while the agent is stopped leaves the old desk "Not running" and the new one plain.
- The registry can list a session more than once (a resume leaves the old process's entry); the session counts as running while any of its entries is live.
- Sessions that never got a prompt are left out of the Went home list.

### Desk name

- The desk shows, in order: the AI-Kanban card summary, the card title, a short task name written by Haiku from the first message (only when the owner set an Anthropic key), the first real user message cut to 60 characters, the session's own name. When the first message is only a paste, the "Pasted text" placeholder goes after the session's own name, so the owner's `/rename` beats it.
- Slash commands, `!` bash-mode input and interrupt notices are not used as the first message.
- A message that starts with a `<tag …>…</tag>` block (any tag name) has that block removed, repeatedly, and the rest is used; if nothing is left the message is skipped and the next one is tried. The hook removes these leading blocks before its length cuts, so the words typed after Claude in Chrome's 4,000-character `<browser_instruction>` block are kept. A `<browser_instruction>` block cut before its close tag is never used as a name or a request.
- A card created, renamed or removed later updates the desk; a name given with `/rename` later is picked up.
- The owner's name beats every automatic name above. It is stored on the conversation's session row (`ownerName`, up to 60 characters, one line), apart from the agent's desk name, so agent writes never touch it and it survives Wake (same row); a `/clear` starts a new conversation with no owner's name, and the row's removal 7 days after it ends takes the name with it. The name shows on the card title, the canvas label, the phone tiles, the iPad card strip and the Went home rows. Saving an empty name, or the automatic name itself, takes the owner's name away so the automatic name shows again. The device that renamed shows the new name at once; other devices get it on their next poll.

### The paste tag and Haiku task names

- The paste tag (`<pasted_content …>`) is never shown on a desk, wherever it sits in the message. Typed words around a paste name the desk. A message that is only a paste shows "Pasted text". The hook strips paste blocks before it cuts the prompt to 2,000 characters, so typed words after a long paste are kept.
- When the owner set an Anthropic key in the agent's config, every session is named: the agent asks Haiku (`claude-haiku-5-5`, plain `fetch`, no SDK) for a short task title (at most 6 words, a title and not a sentence, in the language of the message, no closing punctuation) from the first 1,000 characters of the first real user message, or of the first paste when the message is only a paste. A hired employee is named from its hire message the same way, and sessions already running when the agent starts are named too.
- One call per session: the answer or a final failure is cached in `~/.claude-office/task-names.json` (mode 0600, newest 500 kept), so a restart does not ask again; the old `pasted-names.json` is still read so earlier paste names survive. No call when there is no key, when a card name already covers the desk, when the first message is held, or when the session already went home. Without a key a desk is named as before.
- Haiku is told to reply `NONE` when the message does not say what the task is. A `NONE` reply (any case) and a reply longer than the desk's 60 characters (a sentence, not a title) are final failures; the desk keeps the first-message name. Cached names that end in "…" were cut, so they are dropped when the cache is loaded and the session is asked again.
- A network error, 5xx or 429 is retried once after 30 s; other 4xx, a refusal and an empty answer are final and cached as "Pasted text". A 401 or 403 (bad key) is not cached, so a corrected key and an agent restart name the session.
- The call never delays the agent: the hook listener opens before any pending call finishes. The key, headers and message text are never logged.

### The original request

- The first real user message (the one the desk name uses; commands, `!` input and interrupt notices excluded) is stored on the session row as `request`, up to 2,000 characters with its line breaks, and sent to the browser. The original request is the whole message as sent, pasted parts included in order (without the paste tag), so a paste-only employee shows what it was asked; the hook forwards the first 4,000 characters of the message so typed words after a long paste still count toward the 2,000.
- The details card shows an info button (label "Show the original request") next to the name; it opens a popup with the full request, scrollable, closed by Escape, the × button or a click outside. A session without a request has no button. The desk itself gains no text or button.
- The hover tooltip of an employee shows the full short name wrapped between words (up to three lines) instead of cut at one line.

### Steps

- The details card shows a "Recent steps" list, newest first, of finished steps; each step is one line (full text on hover) with its duration on the right; failed and stopped steps are muted. The running step is shown in the card's terminal box above, not in the list.
- "More steps" sits below the list and pages back up to a week; a session with no finished steps says "No finished steps yet".
- Step text: Read/Edit/Write show the verb and file name; Bash shows its description, else "Bash"; Agent shows "Agent: <description>"; Grep/Glob show "Search '<pattern>'"; WebSearch shows the query; WebFetch shows the domain; any other tool shows its name. A Bash or Agent step started in the background ends with "(started in background)". Text is cut at 120 characters.
- The to-do tool is not a step; it sets the desk's current to-do line.
- Failed, denied and stopped steps are marked; an API-error turn end adds one "API error" step.
- Durations are never shown below zero; steps older than a week are hidden.
- A subagent's own tool events are skipped; the parent shows one "Agent: ..." step.

### The details card

- **Rename:** a pencil beside the title (button "Rename employee", also on went-home and Mac-offline employees) opens a modal dialog with a Name field filled with the current name, the line `Leave it empty to get the automatic name back: "<automatic name>".`, Cancel and Save. Enter saves, Escape, Cancel or the backdrop cancel; saving a name that changes nothing sends no request. One save sends one request (`POST /api/office/sessions/name`, owner only; 404 when the row is gone, never creating a row). A refused save keeps the dialog open with "Could not rename. Try again." and puts the old name back on this device.
- **State band:** the state in the room's colour, then how long the session has been in that state, for example `WORKING · 3m 12s` (only the state word is uppercased). Thinking keeps its own word "THINKING" in the Working colour. The needs-permission band reads "NEEDS YOU". Went home shows "Went home" in grey with the time since it went home; a Mac that is offline shows a grey "Mac offline" with no time.
- **Time in state:** the agent stamps `stateSince` when the room the session is in changes, so a flip between Working and Thinking keeps the time running. After an agent restart the stamp comes from the time the owner moved a Review employee to Idle (on every restart, not just the first), else, for a stored Review still seeded as Review, its stored stamp (Move to Idle names a Review by it, so a restart never changes which Review a click clears), else the registry's `statusUpdatedAt`, else the stored stamp when the room is unchanged, else now. The browser counts from the server's clock (`serverNow` on every changes answer), clamps below zero, and the format is `45s`, `3m 12s`, `1h 05m`, `2d 3h`. Rows from before the stamp show no time.
- **Project and tags:** the project (when there is one) and up to three `#tag` chips, then `+N`.
- **Terminal box:** Working shows the running step and its time, or "working…"; Thinking "thinking…"; Waiting for you "waiting for your reply"; Idle and Review the last finished step, or no box. Needs permission shows "Wants to run" and, only when exactly one step is running, its text. The folder line and the current to-do stay; the box is hidden for an offline Mac.
- **Remote Control button:** "Approve in Remote Control" on a needs-permission session whose Mac is online, "Open Remote Control" otherwise (also on a Mac-offline card), absent for a went-home or not-running desk and for a waiting or starting hire. Details of the link are under Remote Control.
- **Move to Idle:** a Review employee's card has a "Move to Idle" button with the line "Moving to Idle means you have seen the result. It stays in your list, in the same place." (see [Moving a Review employee to Idle](#moving-a-review-employee-to-idle)). It shows whenever the state is Review, also when the Mac is offline, and for no other state. There is no "finished" result block.
- **Place in your list:** "PLACE IN YOUR LIST · now 2nd of 17" with Move to top and Move to bottom buttons, below Open Remote Control on every card of a live employee (phone, iPad and desktop; also while its Mac is offline) and absent for a went-home one. The place counts the company's whole list in the owner's order, whatever the repo filter hides. The button for the end the row already stands at is disabled (`aria-disabled`) and sends nothing. A press is one `POST /api/office/sessions/rank` request, shown at once and taken back when refused, with "Could not move. Try again." in the card's place block (and under the list header when the list shows, so a folded list or a phone still tells the owner); moving to the top also places every row that has no place yet, because those always sort above placed ones.
- **Footer:** the Mac name and the folder with the home folder as `~` and long paths cut in the middle (full path on hover).
- The sheet is a bottom sheet on a phone, an iPad and a narrow window (at most 80% of the height); on a desktop only the steps list scrolls. On a short screen (height at most 500 px, such as a phone held sideways) the whole sheet scrolls, so the recent steps keep their natural height, and the "Recent steps" heading is hidden.

### Moving a Review employee to Idle

- The button sends one request, `POST /api/office/sessions/review-seen`, with a list of 1 to 200 `{machineId, sessionId, stateSince}` items: the `stateSince` of the Review the owner saw. It is owner-only (401 otherwise, 400 for a malformed body) and answers `{marked: N}`.
- The server marks only rows still in that very Review (state `review` and the same `stateSince`); a row that already moved on is skipped, so N can be lower than sent. A mark is `reviewSeenAt` (the Review's `stateSince`) plus `reviewClearedAt` and `changedAt`, both from the database clock, so the Mac's clock never takes part.
- The changes answer then shows a row as Idle while its state is Review and `reviewSeenAt` equals its `stateSince`, with `stateSince` set to `reviewClearedAt`: Idle time counts from the move. This works while the Mac is offline, and every device reads it on its next poll. The agent keeps publishing `review` with the same `stateSince`, so the mark holds; a later Review has a new `stateSince`, so it shows as Review again (a background sub-agent finishing after a clear starts a new turn this way).
- The device that pressed the button shows Idle at once (a pending move laid over the answers until one shows something other than that Review). A refused or failed request puts Review back and shows "Could not move to Idle. Try again." on the card.
- After an agent restart, a stored Review whose stored `reviewSeenAt` equals its stored `stateSince` is seeded as Idle; a mark for an earlier Review does not count, and a registry status other than idle is mid-turn and not cleared. A click that lands between the seed's read and its write needs one more click.

### The list

- On a desktop, an iPad and a narrow window a 400 px panel (at most 60% of the width) sits beside the office, headed `<company> · N employees` (the same rows as "Everyone"). A real phone has no list.
- "Everyone" holds the viewed company's live employees, narrowed by the repo filter, in the owner's order: employees with no place of their own first, newest first, then the placed ones by their place (text compared by character code, equal places by session key). A place is the optional `rank` on the session row: lowercase letters, at most 64, never ending in "a".
- Each row shows the picture (a badge for needs-permission, waiting and Review), the name (two lines at most), the first repo tag and `+N`, then `<state word> · <time in state> · <context line>`. The state word and context line follow one rule for rows and the card: Working shows the latest running step, Thinking "thinking…", Needs permission "wants to run: <step>" (only when exactly one step runs), Waiting for you "waiting for your reply", Idle "last: <latest step>", Review nothing more; Not running, Waiting at the Mac, Starting and Mac offline replace the room word and never read Idle, and a Mac-offline row has no time and is dimmed.
- A Review row has an "Idle" button (the same move as the card's), every row has a pencil that opens the rename dialog, and a row with Remote Control has an open (or, for needs permission, approve) link; there is no link for a desk that is not running or still opening.
- Clicking a row selects its employee in the office (outlined, the camera follows it) and opens its card; clicking the selected row again keeps it selected. Clicking an employee in the office highlights its row (`aria-current`) and scrolls it into view; a click in the list never scrolls the list. Closing the card clears the outline and the highlight; clicking empty floor clears only the outline. Opening a went-home row shows its card and selects no one in the office.
- A conversation that appears after this device first showed the list joins the top (it has no place yet) with a small "new" dot (accessible name "new") until the owner opens it from anywhere (list, office, Went home); a hire counts as new too. Each device remembers what it has opened under the browser storage key `claude-office.seen-rows`: with nothing readable stored, every conversation the first answer holds counts as already seen, the newest 1000 opened conversations are remembered, so one resumed after a long while shows no dot, and with storage unavailable no row gets a dot. A conversation that went home and is woken keeps its place, because its session row and `rank` are never cleared.
- With a mouse the owner drags a row in Everyone to a new place (a move of 8 px starts the drag; a plain click still selects; Esc cancels; dropping on its own place does nothing). Hidden rows (a tag filter) keep their order; the row lands right after the visible row above it. The first move in a company gives every row that has no place yet a place, in the order shown, because rows with no place always sort above placed ones; later moves place only the moved row. One drop is one request, `POST /api/office/sessions/rank` (owner only; 1 to 200 `{machineId, sessionId, rank}`, no row twice, else 400): it sets `rank` and stamps `changedAt` on each existing row without creating any, and answers `{written: N}`. The row shows its new place at once on the dragging device and stays until an answer shows the place (or a later change of the row); a refused save puts the rows back and shows "Could not move. Try again." under the list header. Other devices see the new order after their next poll. The order of the rows is frozen from the start of a drag to the drop, but the drop lands on the place of the row it was dropped on, counted in the order as it is when released (a conversation that arrived meanwhile counts). Each row has a grip labelled "Drag to reorder"; the dragged row is solid and above its neighbours, a dashed "Drops here" gap marks its slot, and a status chip near the bottom of the list reads "Moving <name> to position N of M" while it is dragged, and a screen reader hears the same (keyboard dragging is off). The rename dialog opens from one place in the panel, outside the rows, so pressing or dragging inside it never starts a drag. If repeated moves make a place longer than the 64 characters the server accepts, every row of the company is placed afresh in that one request. While a row is dragged its employee is outlined in the office as if hovered. Touch screens do not drag yet.
- **Needs you** is a section above Everyone that copies every employee in Needs permission, Waiting for you or Review, as a row with its badge, name, time in state, a company chip when it belongs to another company, an Idle button on a Review copy and a Remote Control link reading "Approve ↗" (yellow, for Needs permission) or "Open ↗" (none without a Remote Control id). The viewed company's copies come first in the owner's order, then "In other companies" with each other company's copies in the strip's company order and each company's own order. Each group shows 4 rows, then "and N more" that expands that group in place; the header badge counts every listed copy. Employees of an offline Mac are left out, as in the strip badges, and the repo filter never narrows the section. The section is absent when nobody needs the owner. Clicking a copy opens the original: another company is shown first, and a repo filter that hides the original is cleared; the original keeps its place in Everyone and both rows show the selection highlight.
- **Move all N Review to Idle** sits in the Needs you header while any listed copy is in Review. N counts every Review copy the section lists, those hidden behind "and N more" and those of other companies included. One press is one request to `review-seen` carrying `{machineId, sessionId, stateSince}` for each; every row shows Idle at once on this device, the server clears only those still in that Review (so fewer may be marked, quietly), and the button disappears with the last Review. A refused request puts every row back and shows "Could not move to Idle. Try again." in the section.
- **Folding:** Needs you, Everyone and Went home each have a header button (`aria-expanded`) that folds the section; a folded Needs you keeps its header, count and Move all button. Section folds are remembered on the device under the browser storage key `claude-office.list-folds` (unreadable or missing fields fall back to Needs you open, Everyone open, Went home folded). The `»` button in the panel header folds the whole list to a 48 px strip showing "!", the Needs you total (muted 0 when nobody needs the owner) and a vertical "Needs you"; its label reads "8 need you, 3 of them in other companies: open the list" and pressing it opens the list. The whole-list fold is not remembered: the list is open at every load. A new arrival (an employee that newly needs the owner, in any company; a state change among Needs permission, Waiting and Review or a re-sort is not one) reopens the Needs you section only; the first answer after a load records what is there and is not an arrival, and a folded strip stays folded while its count follows.
- Times tick once a second inside each row, so the page does not re-render every second.

### Searching for an employee

- **Cmd+K** (Ctrl+K on Windows and Linux) or the "⌘K Search" button in the list header opens a palette on a desktop, an iPad and a narrow window, also while the list is folded; it is ignored while a dialog such as Hire or rename is open, and a phone has its own search field instead. The palette searches every company, the repo filter ignored, and the employees that went home today (never an older or never-prompted ended row); an empty query shows nothing.
- A query matches an employee when **every word starts a word** inside one of four texts (words in different texts never combine, and the words may come in any order): its **Name** (the owner's name and the automatic name both count), its **Tab name** (the name of its Claude or Cursor conversation tab, set with /rename, which the desk may not show when a card or task name takes its place; the agent publishes it as its own `tabName` field), its **First request** (up to 2,000 characters) or its **Last step** (the running step, else the latest finished one). A word starts after a space or punctuation (`/ - _ . : ( ) ' "`) or at a capital inside a camel-case word, so "panel" finds `LeaderboardPanel`. Case and accents are ignored and đ reads as d, so "nguyen" finds "Nguyễn".
- Each match says why: a line "Name: …", "Automatic name: …" (only when the owner renamed the employee and the query hits its old automatic name), "Tab name: …", "First request: …" or "Last step: …" with the matched words picked out and about a line of context either side, cut with an ellipsis (conversation text is only ever shown as text). The palette orders matches Name, then Tab name, then First request, then Last step, in three groups: Needs you, Everyone, Went home today; a row that went home says "Went home HH:MM" beside its company. The footer reads "Search never changes your order".
- Up and Down choose a match, Enter shows it: the palette closes, its company is shown, a repo filter that hides it is cleared and its card opens (an employee that went home has no one in the office, so only its card opens). Cmd+Enter opens the match's Remote Control page in a new tab and leaves the palette open; with no Remote Control id, or for an employee that went home, has no process or is still opening (whose card shows no link either), nothing opens and the row says "Remote Control off". Enter and the arrow keys are ignored while a Telex or other composition is in progress.
- Escape closes only the palette, also over an open drawer or card, and the focus goes back to where it was.

### Went home

- A closed session leaves the office and appears in "Went home today", newest first, with its desk name in full (wrapped), where it was, and the time it went home (local HH:MM); the list follows the selected company, not the repo filter. "Where" reads `Mac / company/project`: the project is left off when the session started at the company folder, a session in Other reads `Mac / Other/<folder>`, and a renamed company shows its new name.
- The section sits at the bottom of the list on a desktop, an iPad and a narrow window, folded to begin with. Its header reads "Went home today" with how many employees of the viewed company went home today, shown at 0; unfolded with none, it says "Nobody has gone home today". On a real phone a "Went home N" button in the bottom bar opens a sheet with the same rows.
- Rows read the desk name, `Mac / company/project` and `left HH:MM`, newest first. On a phone the sheet header reads "Went home today" and `<company> · newest first`.
- "Today" is the browser's local day.
- Clicking a row opens details with steps but no Remote Control link, and a Wake button, and selects no one in the office. The section stays open beside the card; on a phone the details sheet opens over the sheet and closing it shows the sheet again.
- Opening a row does not close an open details card.
- A resumed session returns to the office.
- **Waking:** Wake appears in the details card of a went-home employee (only today's list leads to one) and of a kept employee that is not running; it is absent for a running, waiting or starting employee, and disabled for an offline Mac, for an agent older than 0.3.0 (the card says to update it) and while its order is pending. One click sends one order. The card warns "will wait at the Mac for you to trust this folder" when the start folder's `cliTrusted` is false, and shows the order's outcome while that employee is selected ("Waking…", "Not woken: open elsewhere", other failure reasons, "Not sent"); selecting another employee and back shows the same outcome.
- The office route accepts a row that reads went home or not running; the agent is the real gate. It refuses, ending the order failed and opening nothing, when any registry entry with that session id, of any kind (a hidden `claude -p` run included), has a live process (`openElsewhere`); when a launch for that session is still waiting or starting (`openElsewhere`); when the registry or the process table cannot be read (`cannotCheckOpen`, "the Mac could not check whether it is open elsewhere. Try again."); when the start folder is gone (`folderMissing`) or the transcript is gone (`conversationNotFound`). The agent resumes in the start folder it stored for that conversation, never the folder an order carries, and a conversation it has no stored row for ends `conversationNotFound`; a session id that is not a UUID ends `invalidOrder` ("Not woken: the Mac refused the order as not valid."). The agent runs one poll at a time, reads everything it needs before the window opens and adds the session to an in-memory waking set before its first await (the tracker marks it launching as soon as the window has opened), so two wake orders for one session never open two windows. The route also refuses a wake (409 "a wake for this employee is already on its way") while a wake order for that session is claimed or pending within the 30 s pickup window. Checking and opening are not one atomic step, so a window opened by hand in the same instant can slip through. A row may still read went home while a refusal says the conversation is open elsewhere.
- A wake opens a Terminal window running `claude --resume <id> --remote-control` in the folder the session started in. The desk comes back at once, kept as `woken`, keeping its stored name, "waiting at the Mac" or "starting" by that folder's trust, and becomes a normal desk with the same Remote Control link (checked with Claude Code 2.1.267: `claude --resume <id> --remote-control` keeps the session id and bridge session) once Claude Code registers the session. It stays until its window closes ("Not running"). Wake works the same after an agent restart.
- A session whose process died, or whose pid now belongs to another session, goes home; a session found already dead when the agent starts is dated no later than the Mac's last heartbeat.

### Hiring

- The Hire button ("+ Hire") floats over the office canvas's bottom-right corner on a desktop, an iPad and a narrow window, beside the list. It is hidden while the All companies drawer is open and, on an iPad or narrow window, while a details sheet is open, since those cover that corner; on desktop the details panel sits top-left, so the button stays. On a real phone Hire is in the bottom bar instead (see [Phone](#phone)). Its dialog opens on the viewed company's Mac and folder and asks for a Mac, one of that Mac's known folders and a first message. The message is sent verbatim, leading spaces and indentation included; a blank one is refused, and one over 100,000 characters is refused with a 400 ("message too long") that the dialog turns into a plain sentence.
- Only folders the Mac has already shown the office, and that still exist there, are listed; the agent checks existence at start and every heartbeat.
- A Mac that is offline or has no record counts as offline; one whose agent is older than 0.3.0 or reports no version is greyed with "update this Mac's agent". Neither can be picked, and the server refuses them with a 409.
- Submitting writes one order to the `commands` collection. The agent polls every second, claims its own Mac's fresh orders by the database clock, erases the message from the order, and opens a Terminal window running `claude --remote-control --session-id <id>` in the folder with the message as its first prompt.
- The script file holds no message text: the message sits in a private file next to it that the script deletes as soon as it has read it, and both files are deleted once a registry entry with a live process has the session's id (the dead entry a woken session still has does not count). While Claude runs, the first message is an argument of its process, so `ps` shows it to anyone logged in to that Mac.
- The agent checks every order right after claiming it against one schema per kind (a UUID session id; for a hire also an absolute folder and a non-blank message within the length limit). A row that fails ends failed with `invalidOrder` ("The Mac refused the order as not valid.") and nothing runs, and the claim only takes kinds the agent knows. A hire also goes only into a folder on the Mac's own folder list (`folders` collection); any other folder ends the order `invalidOrder` even when it exists. The session id is a UUID and appears in the script bare only if it is made of letters, digits, `_` and `-`, otherwise single-quoted; the folder and the claude path are always single-quoted. Launch file names are built only from a UUID.
- The employee's desk appears as soon as the window opens, in the folder's company, marked kept (`hired`), named from the first message by the usual 60-character rule; a kept session is never dropped for waiting too long for its registry entry. Until Claude Code registers the session it is "waiting at the Mac" (state needs permission, so it sits in the Needs permission room and counts toward the company's "needs you" badge) when the folder is untrusted or the Mac cannot tell, and "starting" (idle) when the folder is trusted. Both are published from the agent's own launch record, survive an agent restart, and clear when the registry entry with that session id appears; with an unreadable registry, the window's SessionStart or first-prompt hook clears them instead (a woken desk counts only a hook newer than its window opened). A window that registers nothing and sends no hook for 30 minutes after it opened (the owner answered "No, exit", or the script was lost) shows "Not running" instead, so Wake is allowed; if its registry entry or its SessionStart hook appears later the desk goes back to running. The 30 minutes count from when the window opened, also across an agent restart.
- The agent reports each known folder's trust, read-only from `~/.claude.json` (`projects[<path>].hasTrustDialogAccepted`), at start and every heartbeat, and the office receives it as `cliTrusted`. The rule is what was observed, not documented: the nearest recorded answer at the folder or a parent wins, the walk stops at the git root (a `.git` folder or file, so a worktree is its own root), a folder with no git root above it walks up to `/`, and the real path is looked up before the path as typed. A missing, unparsable or project-less file leaves trust unset on every folder and the office shows no warning (the agent logs one line, never the file's contents). The agent never writes `~/.claude.json`.
- The hire dialog warns "will wait at the Mac for you to trust this folder" when the chosen folder has `cliTrusted === false`. Trust refreshes every 60 seconds, so the dialog may still warn for up to a minute after the owner trusted the folder at the Mac.
- The form scrolls inside the dialog on a short screen (a phone turned sideways, the keyboard up), so the Hire button stays reachable. The dialog's fields and button are locked from the click until the order resolves, and it sends one order however often the button is pressed; the × button and Escape still close it, and the order then runs without its outcome being shown. It shows the reason when the order fails (folder missing, Claude Code not found, the window could not open, the agent restarted before the window opened). The Terminal opener gets 30 seconds; past that the order fails as "the window could not open" and the agent goes on to the next order. Wake and Dismiss word an interrupted order for what they do ("Not woken: ... before the window opened", "Not dismissed: the Mac's agent restarted first"). "Not sent" appears only when the office reports the order unclaimed after 30 seconds by the database clock (or no longer known), after which nothing runs later. After 35 seconds without an answer from the office it says the office lost contact and that the Mac may still run the hire. An order still claimed 2 minutes after it was given stops the polling and tells the owner to check the Mac. It closes itself when the window opened.
- The hire, wake and dismiss routes also refuse (400) a hire into a folder the Mac does not list or that no longer exists ("The Mac does not know that folder any more. Pick another folder."), a wake of a row that is waiting, starting or running, and a dismiss of a row that is not kept.
- Switched-off company folders still appear in the hire list; only folders gone from disk are dropped. Renaming a company that had no folder record creates one, so that folder joins the hire list until the Mac reports it gone.
- The Mac looks for Claude Code on the agent's PATH, then `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`; otherwise the order fails "Claude Code was not found on the Mac."
- After not sent, failed, lost contact or check the Mac, the dialog button reads "Try again".
- The card's update notes read "Update this Mac's agent to wake employees." and "Update this Mac's agent to dismiss employees."
- An order the agent claimed but never finished when it restarts is marked failed `interrupted`; nothing opens late.
- When a hired employee's Terminal window closes (its process ends, or its end hook fires) the desk stays: idle, marked not running since the closing time, with no running steps, no Remote Control link and no went-home time; it counts as Idle and never enters Went home. The agent restores such desks, with their names, when it restarts; a restart that cannot read the registry leaves a desk as running until the registry can be read, and a live registry entry of another process (the conversation resumed elsewhere) brings a Not running desk back to running, with no old Remote Control link. The details card says "Not running" and shows no Remote Control line or terminal box; the desk itself gains no text.
- The details card of a waiting or starting hire says "Waiting at the Mac" (with what to do there: trust the folder, then click the window before typing) or "Starting" (with "Starting on the Mac."), shows no Remote Control line, link or terminal box, and outranks "Mac offline"; "Went home" and "Not running" outrank it. The desk itself gains no text.

### Dismissing

- Dismiss appears in the details card of a kept (hired or woken) employee in any state: running, not running, waiting at the Mac or starting. It is absent for other employees and the desk gains nothing. It is disabled for an offline Mac, for an agent older than 0.3.0 (the card says to update it) and while its order is pending. Pressing Dismiss does not send an order: it opens a pop-up (modal, Escape, Cancel or the backdrop cancel with nothing sent, focus starts on Cancel and returns to the Dismiss button) saying "This conversation is still open in a Terminal window on <Mac>. Dismiss ends it and closes the window; you can wake it again later." Its Dismiss button sends exactly one order, marked `endRunning` so the agent may end the conversation; the one-click dismiss of a Not running desk is not marked. A strong line is added for a working, thinking or needs-permission employee ("It is working right now; dismissing stops it." / "It is waiting for your permission; dismissing stops it."), not for a desk waiting at the Mac or starting. The pop-up follows the live card: its Dismiss is disabled when the Mac goes offline. A Mac whose agent is older than 0.4.0 (`DISMISS_MIN_AGENT_VERSION`) gets "your window stays open; close it at the Mac" instead of the window-closing promise. A Not running desk is dismissed at once, with no pop-up. The card shows the order's outcome while that employee is selected ("Dismissing…", "Not dismissed: ...", "Not sent"), and selecting another employee and back shows the same outcome.
- Confirming Dismiss ends the conversation and closes its Terminal window, in this order: (1) the agent finds the conversation's process (its live registry entry, or for a desk still at the trust question the process whose command line is the claude binary with `--session-id <id>` or `--resume <id>` before the first `--`), its terminal device, the descendants it has now, and the window Terminal shows for that device, but only when the process's pid and start time equal the ones the launch script recorded (claude keeps the shell's pid through `exec`), its device equals the recorded one and, when a window id is recorded and Terminal answers, that window is the recorded one (a process that fails this is not the office's: see below); (2) the kept mark is cleared first, so the desk goes home at the dismiss, dated then (a hire that never took a prompt leaves no went-home entry), instead of showing "Not running"; (3) SIGTERM to the conversation, SIGKILL after 5 s with no wait after it (never SIGINT: zsh then skips its exit); (4) the same for the leftover children, all together (3 s); (5) a registry pass sends the desk home; (6) the agent waits up to 5 s for the tab to stop being busy; if it is still busy it ends what is left on that terminal except the login shell, once (all together, 3 s), and waits again; (7) only when the tab is idle is the window closed, by id, and only when the conversation's tab is its only tab; a window that holds other tabs is left open with a note that it holds other tabs; a busy tab is never closed, because Terminal then asks about running processes and ignores every later close. Every pid is checked against its start time right before a signal, and the agent never signals itself or pid 1.
- A process counts as the office's own only when its pid and start time equal the ones the launch script wrote beside the device (a `.pid` record), its terminal device equals the recorded one and, when a window id is recorded and Terminal answers, the window id matches too. Any other process behind a kept desk (resumed by hand in another window, even while Terminal control is denied, after `/clear` in a new one, or on a desk hired before 0.4.0 that has no record) is not signalled and no window is closed: Dismiss only stops keeping the desk, and the order's note says its conversation was left running. A record without a pid (a desk hired by an earlier 0.4.0 build) proves nothing, so it is treated the same way. An order without `endRunning` (sent by a page opened before the pop-up existed, which never warned the owner) ends no running conversation either: Dismiss only stops keeping the desk, closes nothing, and the note says the conversation was left running and to reload the page. A desk with no process left ("Not running") has its recorded window closed only when a fresh process table shows nothing on the recorded device, and the agent never sweeps there; if something runs there the window stays open with a note, and when only the device was recorded (no window id) the window stays open with a note that the owner closes it. Once the desk is no longer kept, a failure to read the Mac's process list (after the signals, or for a Not running desk) ends the order done with a note that the process list could not be read and the owner should check the window, never failed. A hire or wake deletes any old device, pid and window record of that conversation before it opens its window. At start-up the agent deletes the device, pid and window records of every conversation that is not a kept desk, once the kept desks are restored; only a kept desk can be dismissed, so no later Dismiss needs them.
- When the window cannot be closed the conversation still ends and the order is done with a note shown under Dismiss: Terminal control not allowed or timed out ("allow Claude Office to control Terminal at the Mac ... or close the window yourself"), any other Terminal failure (a generic note), the window holding other tabs, the tab still busy, or the window not found. The note is not a failure reason, and an order never ends failed after the conversation ended. The note never contains command text. The note stays on the card after the desk stops being kept (the agent clears the kept mark before it marks the order done), while the Dismiss button goes with the kept mark.
- A not-running, waiting or starting desk goes home at once, dated at the dismiss, so it tops today's went-home list and can be woken from there; the row is written at once, not left for a restart. A hire that never started (it had no prompt) leaves no went-home entry. Its launch script and message files are deleted and the order never held the message.
- Dismiss ends nothing for a session that is no longer kept (a second click that raced the first): the order is done and changes nothing.
- A dismiss order whose session id is not a UUID ends failed (`invalidOrder`) and changes nothing.
- Dismissing an id that is no longer kept ends the order done. A dismissed waiting desk can be woken again: clearing the wait is what lets the wake pass the "still launching" check.
- A kept desk of a Mac that is offline for good cannot be dismissed and clears 7 days after the Mac was last seen, with the session expiry.
- `/clear` or `/resume` in an office-started window moves the kept mark to the new conversation, so a dismiss then applies to the new desk.

### Remote Control

- The details card shows an "Open Remote Control" button linking to `https://claude.ai/code/<bridgeSessionId>` in a new tab on a computer and with no target on the phone layout (any small or touch-sized viewport, including a narrow desktop window), so iOS can hand it to the Claude app (ids containing `/`, `?` or `#` give no link), or a muted "Remote Control off".
- The session registry's `bridgeSessionId` is the source of truth: it is read at start and on every registry check; a hook event that carries the id may set it, but a hook event without it never clears it; the id is cleared only when the registry entry exists and has none.
- Clicking never navigates by itself; the link lives only in the card.

### Staying right when hooks miss things

- The agent re-reads the session registry about every 5 seconds: a dead or reused process goes home, a fresher registry status corrects a stale state, and a changed registry folder updates the start folder. A process counts as the same one when its `ps` start time, read in UTC, equals the registry's `procStart` (Claude Code writes it in UTC).
- After an agent restart, a session whose turn already ended keeps the state stored for it (a Review the owner moved to Idle stays Idle, and its Idle time still counts from the move, however many times the agent restarts); a session that was still working is sorted from its transcript tail into Waiting for you, Review or Idle.
- A session may have several registry entries and counts as running while any of them is live; a wake is refused while any is live.
- If the registry is unreadable or its format changed, the agent runs on hook events alone and sends nothing home.
- Late or out-of-order events do not move a session backwards; writes per session are serialized and steps are deduplicated by id.
- When the database is unreachable, the agent queues a bounded number of writes and catches up.
- Each Mac writes a heartbeat about every 60 seconds; after about 3 minutes without one the office greys that Mac's characters and labels the details "Mac offline".
- If `ps` fails at agent start-up, the agent refuses to start and launchd retries.

### Live updates

- The office page polls for changes about every 3 seconds only while the tab is visible, checks at once when the tab returns, and backs off on failures.
- It shows "Updated N min ago" and a "Connection lost" banner when polling fails; on a 401 it stops and sends the owner to sign-in. A row whose state the page does not know (one a newer server added) shows as Idle; the answer is still accepted.
- The changes API returns what changed since the browser's cursor, with a 5-second overlap, plus every folder record (with the owner's name for the company, when set) and the server's clock; the browser merges sessions by (machine, session).

### Phone

- A real phone is a touch screen whose short side is at most 500 CSS px, in either orientation (a coarse pointer with a width or a height of at most 500 px). An iPad and any window driven by a mouse never count, however narrow. Turning the phone keeps the same view and the same open sheets; there is no special sideways mode, and a sideways phone shows the same bar and rooms with more columns.
- Instead of the pixel office and the card strip, the phone shows the ordered list by default (the **List** view, below); the stacked rooms are the **Rooms** view, kept for a phone whose device setting `phoneView` is `rooms` (browser storage key `claude-office.settings`, a JSON object whose unreadable or missing fields fall back to their defaults; `list` is the default). The list is for a real phone only; an iPad and a narrow desktop window keep the Mac layout.
- **List view:** below the repo pill row and the status line sit a search field (fixed above the list, with a ✕ that clears it) and one scrolling list with the sections Needs you, Everyone and Went home today. Needs you and Went home use the same sections, folds and arrival rule as the Mac list (the folds are shared across devices only by being stored the same way on each), with touch-sized buttons and no inner scrolling. Everyone lists the viewed company in the owner's order (the order a Mac drag saved) narrowed by the repo filter; each row has a grip (it only shows for now), the state picture with its bubble, the name (two lines at most), `<state word> · <time in state> · <context line>`, an Idle button on a Review row and a Remote Control link; there is no "new" dot, no repo chip and no rename button on the phone. Offline rows are dimmed. An empty company shows the Everyone header with "Nobody here yet". Tapping a row, in Needs you or Everyone, opens the details sheet as before.
- **Phone search:** typing in the field replaces the sections with the matches, using the same matcher as Cmd+K (every word starts a word inside the name, the first request or the latest step). The viewed company is searched first, in the owner's own order (not ranked by where each matched; each employee once), ignoring the repo filter; its employees that went home today follow under "Went home today" with "left HH:MM". Each match says why ("Name:", "First request:", "Last step:" with the matched words picked out) and has no grip. A count line reads "N matches · kept in your order" ("No match in <company>" at zero). "Search all companies" adds the other companies' matches in place under "In other companies", each company labelled, updates the count and goes away; opening such a match shows its company first. Searching never touches the stored folds, so clearing the search brings back the sections exactly as they were. The query stays while a card is opened and closed and when the company changes, but "Search all companies" must be asked again in the new company. The Search button in the bottom bar puts the cursor in the field from inside the tap; the iOS keyboard itself is not covered by a test.
- In the **Rooms view** the phone shows the viewed company's employees in five full-width rooms stacked in the order Needs permission, Waiting for you, Review, Working, Idle (a check mark bubble marks Review employees; a Review arrival reopens a folded Review room). The rooms follow the company tab and the repo filter and scroll on their own.
- Each room has a header with the room's colour, its name and its head count, then a grid of tiles (as many columns as fit). A tile shows a small desk, the employee's character (the same look as on the canvas), and its task name cut at two lines (the desk name, else the folder name); Needs permission tiles carry a `!` bubble, Waiting for you tiles a `…` bubble and Review tiles a `✓` bubble. A tile of an offline Mac is greyed. An empty room shows its header and "Nobody here right now".
- Tiles sit in the room that matches the session's state at once (no walking delay), so the room counts match the bar's counts; went-home employees are not shown. Inside a room the employee who has been in its state longest comes first, ties by session.
- Tapping a tile opens the details card as a bottom sheet and marks the tile; tapping another tile moves the sheet and the mark; closing the sheet puts focus back on the tile.
- Tapping a room header with employees folds or opens the room; its count stays. An empty room has nothing to fold. Folds are kept when the company changes but not across a reload. A folded Needs permission, Waiting for you or Review room opens again when an employee newly arrives in it, so a new request is never hidden; people brought in by switching company or repo filter count as arrivals too.
- A row above the rooms holds the repo pill on the left and the status line ("Updated N min ago", "Connection lost") on the right, in the layout's flow, so neither covers a room header.
- A bottom bar stays below the list or the rooms: in the List view it holds "Search" (puts the cursor in the search field, from inside the tap so iOS opens its keyboard) and "+ Hire"; in the Rooms view it holds "Went home N" (opens the went-home sheet) and "+ Hire". It is hidden while any sheet is open (All companies, Went home, the details card, the repo chips) and keeps clear of the phone's home indicator.
- The company bar on a phone shows each company's name and needs-you badge only, tap targets at least 44 px, and "All companies" as a grid icon.
- The company bar, drawer, details sheet and rename rules above apply as written. The phone has no double-tap rename; the drawer pencil renames.
- On the phone layout (any small or touch-sized viewport, including a narrow desktop window) the Remote Control link has no `target`, so iOS opens the Claude app on the session when the app is installed; without the app the link navigates the office tab to claude.ai. Whether iOS hands it to the app is checked by one manual tap, not by a test.

### iPad and narrow windows

- An iPad, a touch tablet up to 1024 px wide and any mouse window up to 768 px wide (for example 700x800) keep the pixel office, panning and pinch-zoom, the list beside the office (the same panel as on a desktop, at most 60% of the width, with no strip of employee cards), and tabs with five counts and the "All companies" text.
- A short but wide mouse window (for example 800x400) gets the same layout.
- On the iPad, tablet and narrow-window screens the details card, the companies drawer and the repo chip panel are bottom sheets, Went home is the list's bottom section, and Hire floats at the bottom-right of the office. The phone's bottom bar and stacked rooms never appear.
- An iPad in Split View at phone width counts as a real phone and gets the stacked rooms.

### Escape

- Escape closes the Cmd+K palette first, and only it, when it is open. Escape closes an open rename dialog and the phone's went-home sheet; on a phone, with the sheet open, a details card opened from it closes first and a second Escape closes the sheet.
- In a rename editor (in a tab or anywhere inside the drawer's editor), Escape cancels the edit only. Otherwise it closes the companies drawer.
- The repo chip panel, the hire dialog and the original-request popup close on Escape.

### Connecting a Mac

- `npm run setup` asks the office for a connect request named after the Mac and prints a link and an 8-character code.
- `/connect` shows the Mac name and the same code; only the signed-in owner can click "Connect this Mac".
- The Mac collects the database connection once; codes live 10 minutes; at most 5 unexpired codes exist at a time.
- Running setup again skips connecting when a valid saved config exists, and keeps an Anthropic key the owner added to it; `npm run setup -- --reconnect` forces a new approval.

### Hooks and agent install

- Setup adds one async command hook for each of 15 events to `~/.claude/settings.json`, next to existing hooks, backs the original up once, and changes nothing on a second run. Hooks run the script through the link `~/.claude/claude-office` to the repo checkout, so updating the checkout updates the hook; running setup again re-points the link if the checkout moved. A hook older than 0.2.0 sends no answer text, so finished turns show as Idle.
- The hook always exits 0, prints nothing, hands the event to the local agent and returns; it has a hard exit timer so a hung agent cannot slow Claude.
- The agent starts at login as a launchd LaunchAgent and restarts if it stops; it also exits by itself after about 5 minutes without a successful database write so launchd starts a fresh one. A long gap between checks is read as a Mac sleep and gets a fresh limit.

### Repo front page

- A visitor to the GitHub repo sees a centred title and description, badges (checks, licence, Node 24+, macOS agent), a walking-office GIF, desktop, phone and details-card screenshots, a features list, a quick start, how it works, what never leaves the Mac, an FAQ, requirements, deploy and Mac setup steps, and a link to CONTRIBUTING.
- The public version is 0.4.0 in `package.json` and in all public text; there is no release.
- A GitHub Actions workflow runs lint, type-check and the unit tests on pushes to `main` and on pull requests (not for Markdown-only changes); it does not run the end-to-end tests. Bug reports use an issue form.
- `npm run capture` rebuilds the README images (including a 1280x640 social preview) from a local Playwright run of a seeded office.
- A unit test checks the image sizes, README links and anchors, the workflow and issue-form YAML, and the version.

## Privacy guarantees

- The text of a shell command never leaves the Mac: the hook keeps only an allowlist of `tool_input` keys, and the agent's schema drops anything else again.
- Tool output, error text and notification text are never stored.
- The end of the assistant's last answer reaches only the local agent and is never stored or published. The original request (pasted parts included, up to 2,000 characters) is stored on the session row. The only other things that leave the Mac are the optional Haiku calls, which only happen when the owner set a key: the first 1,000 characters of every session's first message go to Anthropic to write the task name, and the last 1,000 characters of each finished answer go to Anthropic to sort the turn as Waiting for you, Review or Idle. Nothing from the answer is stored.
- Free text that is stored: the first message (60 characters), the original request (up to 2,000 characters, kept on the session row and removed with it when the row expires), the Haiku task name, Bash and Agent descriptions, search patterns, web queries and domains, file names, the session's name, folder paths and the company names the owner types (up to 100 characters, on the folder record).
- The folder of each step (`file_dir`) stays on the Mac; only each repo tag's name, key and parent folder name are stored and sent.
- The agent's config, address and desk-name cache files are created readable only by the user.
- The first message of a hire passes through the database: the agent erases it from the order when it claims the order, and an order no Mac claims is deleted with its message after about 10 minutes. On the Mac it lives in a file readable only by the user, which the window's script deletes as soon as it has read it (and which is deleted too if the window could not open, on dismiss, or at the next agent start).

## How the pieces fit

- **Hook:** `hooks/claude-office-hook.mjs` reduces each event and posts it to the loopback agent found through `~/.claude-office/agent.json`.
- **Agent:** TypeScript run with `node --import tsx` under `agent/`; tracks sessions, steps, desk names, start folders, repo tags, the time in each state and the heartbeat, and writes to MongoDB only when something changes.
- **Database:** the `claude-office` database; sessions carry their last 5 steps, full steps live in their own collection, folder records (including the owner's company names) in `folders`, hire orders in `commands`; every write stamps `changedAt` with the server's clock.
- **Web app:** Next.js with better-auth (Google); the office page loads once, then polls the changes API. Companies, projects and the bar, drawer, repo filter and the phone's stacked rooms are computed in the browser.
- **Renderer:** pixel-agents v1.5.0 (commit b1bafd0, MIT) copied into `src/office/` with its licence and credits; characters credit JIK-A-4 MetroCity (CC0).
- **Shared code:** `src/shared/` holds the schemas, step text, desk-name, asks, company, overview and tag rules used by both sides.

## Timings and limits

- Poll about 3 s while visible; changes overlap 5 s; registry check about 5 s; heartbeat about 60 s; Mac offline after about 3 min.
- Agent self-exit after about 5 min without a database write; held-session eviction after 10 min; a waiting or starting desk shows Not running after 30 min without a registry entry or hook.
- Steps, sessions and Mac records expire 7 days after last seen; the agent renews open sessions at most daily. Folder records do not expire.
- Hire orders: the agent polls every 1 s and picks up an order created within the last 30 s; the Terminal opener gets 30 s before the order fails; the dialog polls every 2 s, reports lost contact after 35 s without an answer and "check the Mac" for an order still claimed 2 min after it was given; an unclaimed order expires after 10 min, a claimed one after 1 day; the folder-existence and trust refresh runs at start and every 60 s.
- Connect code life 10 min; at most 5 open codes.
- Dismiss: 5 s SIGTERM grace for the conversation, then SIGKILL with no wait after it; 3 s for all leftover children together; 5 s per call to Terminal (a pending macOS permission prompt blocks about a minute, so each call is cut off); 5 s busy wait, a 3 s sweep of what is left (together), a second 5 s busy wait; 21 s in the worst case plus the calls to Terminal, so the whole dismiss stays under about 30 s so a hire queued behind it is still claimed in time. The agent looks for a new window's terminal device for 10 s after opening it.
- Steps API pages default to 50, at most 200.
- Haiku: 10 s per request, one retry after 30 s, 500 cached answers; the turn-end check has 10 s per request, no retry and 500 cached verdicts.
- Repo lookup: 3 s per git call, 4 at once, 2000 folders cached.

## Setting up a Mac

- The owner clones the repo and tells Claude to follow `SETUP.md`.
- It checks Node 24+, runs `npm install`, runs `npm run setup` (connect, hooks, LaunchAgent) and gives checks for each step.
- Optional: an `anthropicApiKey` in `~/.claude-office/config.json` turns on Haiku task names for every session and the Haiku sort of a finished answer into Waiting for you, Review or Idle.
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
- **Short-screen details sheet scrolls as a whole:** the steps would otherwise shrink to nothing behind "More steps".
- **Repo filter is a floating pill, not part of the bar:** the bar holds companies only; a filter button on the bar and a repo shelf under it (which costs office height) were rejected.
- **"All companies" is pinned at the bar's edge:** it must not scroll away when there are many companies.
- **Mac groups fold like browser tab groups:** the viewed company stays visible and a badge counts waiting work in the hidden ones, so folding never hides where the owner is or work waiting on them; the fold is remembered per browser.
- **Rename lives on the folder record:** stored per Mac and folder next to company mode so every device sees it, shown at once like a company-mode switch, and the agent never writes it. The pencil sits in the drawer because it is easy to find on a phone.
- **A phone shows stacked rooms, not the pixel office:** the canvas is too small to read there; one room at a time and a list with a map toggle were rejected. Desktop keeps the pixel office.
- **Real phone means touch plus a short side of 500 px or less:** over "everything under 768 px", which would catch iPads and narrow desktop windows. These keep the pixel office.
- **No sideways phone mode:** a sideways phone shows the same stacked rooms with more columns, so there is one layout to keep right.
- **Phone bottom bar:** "Went home N" and "+ Hire" are always reachable without scrolling.
- **Stacked rooms place employees by state at once:** the canvas's 2-second walk delay exists only to time the walk, and the room counts must match the bar's.
- **A new request reopens a folded room:** Needs permission and Waiting for you open again on an arrival, so a fold never hides a new request.
- **Went home is the list's folded bottom section off the phone:** the list fills the right side, so there is no separate Went home button or drawer there; the phone keeps its sheet.
- **List and drawer:** the companies drawer floats over the office; the list is always beside it.
- **Version 0.4.0, no release:** Dismiss closing windows needs agents on 0.4.0 (`DISMISS_MIN_AGENT_VERSION`), and a larger number would overstate how finished the app is.
- **Mutation survivors:** survivors get tests unless they change no visible behavior.
- **Hook install stays in this repo;** moving it to AI-rules is later work.

## Accepted limits

- The first hire or wake after the agent updates to 0.4.0 makes macOS ask "node wants to control Terminal" (the agent records each window at launch); until the owner clicks Allow, no window id is recorded and Dismiss leaves the window open with a note (a conversation on the recorded device is still ended).
- Docker containers an MCP server started are children of the Docker daemon, not of claude, so Dismiss cannot reach them; whether real claude ends its other children on SIGTERM is unchecked, and the sweep only reaches processes still on the window's terminal.
- A window that holds other tabs is never closed (the owner closes it); closing only the conversation's tab could not be tested against a real Terminal without changing the owner's Terminal settings.
- A dismiss cut short by an agent restart can read "Not dismissed: the Mac's agent restarted first" although the conversation already ended.
- Window records (`<id>.tty`, `<id>.pid`, `<id>.window` in the launch folder) of a conversation that stops being kept without a Dismiss stay on disk until the next agent start.
- A database outage longer than about 5 minutes loses the steps queued during it.
- A stranger can fill the connect-code cap and block connecting for up to 10 minutes.
- Which hook fires after a manual "No" on a permission dialog is not verified, and whether already-open sessions pick up newly installed hooks is not verified; both are manual checks.
- The assumption that `/clear` keeps the process id is unchecked; the rule built on it is harmless if wrong.
- A registry check that lands between a busy flip and the follow-up Stop can drop a remembered question; the result is a missed badge, which is preferred over a false one.
- A window narrower than about 544 CSS px at 2x (360 px at 3x) sees the pixel office at zoom 1; real phones no longer draw it.
- Folder records ride on every changes answer, so many throwaway folders make the answer grow.
- The tag key is a hash of a guessable path; it hides nothing the start folders do not already show.
- A task-name request that failed for good (not a bad key) keeps the first-message name ("Pasted text" for a paste-only one) and is not asked again.
- The art's original source is not stated by the Pixel Agents repo it was copied from.
- The first GitHub Actions run, and with it the checks badge, is unproven until the next push.
- Wake is offered on a dismissed hire that never started; it fails "conversation not found".
- A hire whose response was lost can be sent twice, giving a duplicate employee.
- In a narrow desktop window the Remote Control link uses the phone layout's same-tab link and navigates the office tab.
- A wake followed by a dismiss within milliseconds can leave the desk in either state.

- On an offline Mac the phone's room headers still count the employees waiting on the owner, while the company bar shows no needs-you badge for them, because an offline Mac is not counted as waiting on the owner.
- On a phone, changing the company or the repo filter can bring employees into a folded Needs permission or Waiting for you room; they count as arrivals and the room opens again, even though no new request started.
- With the on-screen keyboard up, a phone's bottom sheet (the rename field, the hire dialog) may be partly covered; the page relies on the browser scrolling the field into view, and only a real phone can confirm it.
- In this repo Tailwind's spacing unit is 1 px (`--spacing: 1px` in `src/app/globals.css`): `h-11` is 11 px, not 44 px, so touch targets are written as `min-h-[44px]`. A class written for a 4 px unit renders at a quarter of its size.

## Not built yet

- Non-interactive sessions (`claude -p`, scheduled prompts, Agent SDK runs).
- Messaging sessions, auto-wake, waking departures older than today, stop buttons, controlled updates, teams, push notifications, one-line summaries, per-session cost.
- A session inspector.
- Desk clusters by project inside a room; seats fill in order today.
- Stacked rooms on an iPad or a narrow window (they keep the pixel office), remembering a phone's folded rooms across reloads, renaming a company by double-tap on a touch screen, and a name for "Other".
- An uninstall command.

## Open items

- Each Mac's agent must be updated to 0.3.0 before it can take orders; until then the office greys out hiring for it.
- The company-layout work (bar, rename, Went home, phone rooms) is web-app only: the one change under `agent/` since the previous version is the optional `displayName` field in the `FolderDocument` type in `agent/folders.ts`, which has no runtime effect, so the Macs need neither a pull nor an agent restart for it; deploy the web app.
- Follow `SETUP.md` on the owner's Mac and confirm a live session shows at the deployed office from the Mac and a phone; then pull the new version on each Mac and restart its agent (`launchctl kickstart -k gui/$(id -u)/dev.quanvo.claude-office.agent`); the hooks follow the checkout through the `~/.claude/claude-office` link.
- Turn on private vulnerability reporting in the GitHub repo settings.
- Check on a real phone: the stacked rooms in both orientations, the bottom bar against the home indicator, and the keyboard over the rename field and the hire dialog.
- The README images (`npm run capture`, including the phone screenshot) were not re-taken for the new bar and phone rooms, and `package.json`, the README, the bug-report template and this file say 0.4.0, the version Dismiss closing windows needs; no release was made.
- Check the first GitHub Actions run after the push; the workflow was not run on GitHub.
- Check the host plan's function-call allowance against about 1,200 polls per hour per visible tab.
- Note for later: the claude-usage tool's repo-name backfill is out of scope here.

## Key files

- `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/require-owner.ts`: sign-in gate; `src/lib/require-online-mac.ts`: refuses orders for a Mac that cannot take them.
- `src/office/` (`sceneSync.ts`, `rooms.ts`, `offline.ts`, `wentHome.ts`, `remoteControl.ts`, `constants.ts` for the phone and mobile media queries, `engine/`, `components/` with `StackedRooms.tsx` and `CharacterMugShot.tsx`, `hooks/useIsPhone.ts`, `useIsMobile.ts`, `useHasMouse.ts`, `useMediaQuery.ts`): office rendering, scene sync and the phone's stacked rooms.
- `src/app/office/`: office page (`OfficeView.tsx`), `CompanyStrip.tsx`, `CompanyDrawer.tsx`, `TagFilter.tsx`, `list/` (the list beside the office, its seen and pending-place helpers), `rowText.ts` (state word and context line), `HireDialog.tsx`, `WakeControl.tsx`, `DismissControl.tsx`, `useOrderStatus.ts`, `RoomSigns.tsx`, `DetailsPanel.tsx`, `StepsList.tsx`, `elapsed.ts`, `WentHomeButton.tsx`, `WentHomeDrawer.tsx`, `PhoneBottomBar.tsx`, `officeStore.ts` (pending switches and names), `reviewSeen.ts` (pending Move to Idle), `collapsedMacs.ts`, `displayName.ts`, `renameRule.ts` (one rule shared by the drawer and tab editors), polling hook, connection status.
- `src/app/api/office/changes`, `src/app/api/office/steps`, `src/app/api/office/folders/company-mode`, `src/app/api/office/folders/display-name`, `src/app/api/office/hire`, `src/app/api/office/wake`, `src/app/api/office/dismiss`, `src/app/api/office/sessions/review-seen`, `src/app/api/office/commands/[id]`, `src/app/api/connect/`: office and connect APIs.
- `src/shared/`: commands, session, session-state, hook-event, step-text, desk-name, asks, folders, companies, overview, tag-labels, tag-filter and connect schemas and rules.
- `hooks/claude-office-hook.mjs`: the hook.
- `agent/`: `session-state.ts`, `tracker.ts`, `steps.ts`, `writer.ts`, `reconcile.ts`, `transcript.ts`, `folders.ts`, `trust.ts`, `repo-resolver.ts`, `task-namer.ts`, `commands.ts`, `terminal-launch.ts`, `kept.ts`, `config.ts`, `heartbeat.ts`, `write-watchdog.ts`, `kanban-watch.ts`, `start-agent.ts`, `main.ts`.
- `agent/orders.ts` (per-kind order schemas), `agent/registry.ts` (print-run and `sdk-` hiding rule).
- `src/lib/insert-order.ts`, `src/app/office/hire.ts`, `wake.ts`, `dismiss.ts`, `post-order.ts`, `order-outcome.ts`: order creation and outcome on the web side; `src/db/indexes.ts`: the orders TTL index.
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
- The company-layout run (bar, rename, Went home, phone rooms; called 0.4.0 in its notes) was 20 behaviors, one commit each on `main` after commit cb1a19d. At its end: 581 unit tests in 103 files (re-run at the final commit), 108 Playwright specs in 21 files (recorded at the tested tip, which has the same tree as the final commit), lint and type-check clean. Playwright is not part of CI.
- Six quality gates ran after groups of those behaviors; their fixes were folded into the owning commits, and every one of the 20 commits type-checks and passes the unit tests on its own.
- Conformance check: all 20 behaviors valid, with caveats that were fixed. Adversarial pass over 68 risks: 57 hold; seven were fixed (a pending name that never settled, an iPad Went home button over the details sheet, the Escape order for a card opened last, Escape on Save or Cancel closing the drawer, a truncated drawer name, a double-click rename resetting the repo filter, and the companies drawer covering "Connection lost"); four were accepted (see Accepted limits).
- Mutation pass: 30 mutants, 25 killed, 5 survived (four false greens and the stacked room order, which only a Playwright spec pinned); all got killing tests.
- The 0.1.0 record: 17 behaviors, 177 unit tests and 21 Playwright specs at the end, a mutation pass of 28 mutants with 24 killed and 4 survivors that got tests.
