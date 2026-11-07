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

When approved, the command saves the database connection to `~/.claude-office/config.json` (readable only by this user) and prints "Connected". It never prints the connection string. Running setup again asks for a new approval and replaces the saved connection.

Use `CLAUDE_OFFICE_URL` to point setup at a different office address; the default is `https://office.quanvo.dev`.

If it fails with "too many connect requests", wait a few minutes (open requests expire after 10 minutes) and run it again.
