# Claude Office

A watch-only pixel-art office that shows every interactive Claude Code session on your Macs.

Each session is an employee who walks between four rooms as its state changes: Working, Thinking, Needs permission and Waiting.

What you see:

- **Desk names:** each employee is labelled with the session's desk name, Mac and folder.
- **Recent steps:** click or tap an employee for a details panel with its latest steps and an "Open in Remote Control" link when the session has one.
- **Went home:** closed sessions leave the office and appear in a "Went home today" list.
- **Phone layout:** the office can be panned and zoomed, with a strip of employee cards and bottom sheets.
- **Sign-in:** Google only, and only one allowed account.

It only watches. It cannot message, stop or control a session.

## How it works

```
Claude Code hooks -> local agent (on each Mac) -> MongoDB <- web app <- your browser
```

- **Hooks:** a small script reduces each Claude Code event and hands it to the agent on the same Mac. It never blocks Claude and always exits quietly.
- **Agent:** a background job (launchd) on each Mac that tracks sessions and writes changes to MongoDB.
- **MongoDB:** the one shared database.
- **Web app:** a Next.js app that reads MongoDB and polls for changes while the tab is visible.

What never leaves the Mac:

- The text of shell commands.
- Tool output, error text and notification text.

What is stored: the first message (cut to 60 characters), Bash and Agent descriptions, search patterns, web queries and domains, file names, the session's name and folder paths.

## Requirements

- **Macs running Claude Code.** The agent uses launchd, so Windows and Linux are not supported for the agent.
- **Node 24 or newer** on each Mac (`.nvmrc` says 24).
- **A MongoDB database.** MongoDB Atlas free tier works. You need a connection string for a user with read and write access to one database.
- **A Google OAuth client** of type "Web application". Add these authorised redirect URIs:
  - `https://<your-domain>/api/auth/callback/google`
  - `http://localhost:3000/api/auth/callback/google` (only if you run it locally)
- **Somewhere to host a Next.js app.** Vercel or any Node host.

## Deploy the web app

Set these environment variables on your host. All are required except `MONGODB_DB`.

- `BETTER_AUTH_SECRET`: a long random string. Make one with `openssl rand -base64 32`.
- `BETTER_AUTH_URL`: the public URL of your deployment, for example `https://office.example.com`.
- `GOOGLE_CLIENT_ID`: from your Google OAuth client.
- `GOOGLE_CLIENT_SECRET`: from your Google OAuth client.
- `ALLOWED_EMAIL`: the only Google account allowed in. Any other account is refused.
- `MONGODB_URI`: your MongoDB connection string.
- `MONGODB_DB`: the database name. Defaults to `claude-office`.

Build and start:

```
npm install
npm run build
npm run start
```

On Vercel the build and start steps are the platform's usual Next.js ones; just set the variables.

Indexes are created for you. The web app builds them the first time it connects to the database, and the agent builds them each time it starts. You do not create them by hand.

Then open your URL and sign in with the allowed Google account.

## Connect each Mac

On every Mac you want in the office:

```
git clone https://github.com/votrungquan1999/claude-office.git
cd claude-office
```

Then follow [SETUP.md](SETUP.md). It is written for Claude Code to follow, but a person can read it too. It installs dependencies, connects the Mac, adds the hooks to `~/.claude/settings.json` and starts the agent at login.

**Run setup with your own address.** The default office URL in setup is the author's (`https://office.quanvo.dev`), not yours. Set `CLAUDE_OFFICE_URL` to your deployment or the Mac will try to connect to the wrong office:

```
CLAUDE_OFFICE_URL=https://<your-domain> npm run setup
```

Setup prints a link and an 8-character code, opens the link, and waits up to 10 minutes. Sign in, check that the page shows this Mac's name and the same code as the terminal, then click "Connect this Mac".

Running setup again is safe. It keeps a valid saved connection. To ask for a new approval and replace the saved connection, run:

```
CLAUDE_OFFICE_URL=https://<your-domain> npm run setup -- --reconnect
```

## Set it up with Claude Code

From the cloned repo, start Claude Code and paste this:

```
Set up Claude Office on this Mac. Read README.md and SETUP.md first.

1. Ask me for my deployed office URL. If I have not deployed the web app yet, help me deploy it first. List the environment variables it needs (see "Deploy the web app" in README.md) and pause while I create the MongoDB database and the Google OAuth client myself. Never ask me to paste a secret, connection string or client secret into this chat. I will set those in my host's dashboard (or in .env.local for local runs) myself.
2. Once I give you the URL, run the setup from SETUP.md on this Mac with CLAUDE_OFFICE_URL set to that URL, for example: CLAUDE_OFFICE_URL=https://<my-domain> npm run setup
3. When it prints the link and code, walk me through the one approval click: sign in with Google, check the page shows this Mac's name and the same code as the terminal, then click "Connect this Mac".
4. Verify the agent is running using the checks at the end of SETUP.md (step 5) and tell me the result.
```

## Run locally for development

Only needed if you want to work on the web app itself.

- Copy `.env.example` to `.env.local` and fill it in. Keep `BETTER_AUTH_URL=http://localhost:3000`.
- Your Google OAuth client must list `http://localhost:3000/api/auth/callback/google` as a redirect URI.
- Run `npm run dev` and open http://localhost:3000. It reads and writes the database in `MONGODB_URI`.

Checks:

- `npm run test:run`: unit and integration tests.
- `npm run test:e2e`: browser tests (Playwright).
- `npm run lint`: Biome.
- `npx tsc --noEmit`: type check.

## Uninstall

There is no uninstall command. [SETUP.md](SETUP.md) lists what to remove by hand: the hook entries in `~/.claude/settings.json`, the `~/.claude/claude-office` link, the launchd job and `~/.claude-office/`.

## Credits and licences

The renderer and art come from [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT), and the character sprites are based on JIK-A-4's Metro City pack (CC0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

This repository has no LICENSE file yet, so the licence for its own code is not yet chosen. Third-party parts keep their own licences.
