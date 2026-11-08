# Contributing

Thanks for helping. This guide covers working on the web app and the agent. To install Claude Office on a Mac, see [SETUP.md](SETUP.md) instead.

## Set up

- Use Node 24 or newer (`.nvmrc` says 24) and run `npm install`.
- Copy `.env.example` to `.env.local` and fill it in. Keep `BETTER_AUTH_URL=http://localhost:3000`.
- Your Google OAuth client must list `http://localhost:3000/api/auth/callback/google` as an authorised redirect URI.
- Run `npm run dev` and open http://localhost:3000. It reads and writes the database in `MONGODB_URI`, so point it at a throwaway database.

## Checks

Run these before you open a pull request. CI runs the first three.

- `npm run lint`: Biome.
- `npm run typecheck`: TypeScript, no emit.
- `npm run test:run`: unit and integration tests (Vitest).
- `npm run test:e2e`: browser tests (Playwright). Run these when you touch the UI.

## How the tests work

- **Fake Mac:** agent tests run against a fake `~/.claude` folder and a fake home directory, so they never read your real sessions.
- **In-memory MongoDB:** tests start their own database with `mongodb-memory-server`. The first run downloads a MongoDB binary unless one is installed.
- **Playwright:** `npm run test:e2e` starts its own web app on port 4710 with its own build folder, so it never touches a dev server you have open. It signs in with a test cookie, so no Google account is needed.
- **No real Claude sessions and no paid calls.** The desk-name call to Anthropic is tested against a fake.

Write the test first and run it before you write the behaviour it checks.

## Pictures in the README

`npm run capture` starts the test server, fills it with a made-up office and saves the README pictures to `docs/images/`. Run it after a visual change. It uses `ffmpeg` for the GIF and the social preview.

## Commits

- One change per commit, with a short subject in the style of the log: `feat(office): ...`, `fix(agent): ...`.
- Say what the owner or visitor can now do, not which files changed.
- Keep secrets, real folder names and real session data out of code, tests and pictures.

## Reporting a bug

Use the bug report form under Issues. It asks for your macOS, Node and Claude Code versions and the agent log.
