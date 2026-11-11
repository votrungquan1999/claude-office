# 0001: The web gives a Mac orders through a polled `commands` collection

- Status: accepted
- Date: 2026-11-10

## Context

The office was watch-only: every Mac's agent writes to the database and the web only reads. Hiring an employee needs the opposite direction, the web asking one Mac's agent to do something. The agent already polls and writes on timers, runs one per Mac, and reaches the database with the connection string in `~/.claude-office/config.json`. The web app is hosted elsewhere and cannot reach a Mac directly. Later features, such as stop buttons or background runs, would need the same path.

## Decision

The owner-only routes write one row per order into a `commands` collection. Each agent polls about once a second and claims only its own Mac's rows with an atomic find-and-update, so an order runs at most once. Times come from the database clock: an order older than 30 seconds at claim is never claimed, and an unclaimed order is deleted by a TTL index after 10 minutes. The claim erases the first message from the row and extends the row's life to a day, so the outcome can still be read. An order left claimed when the agent restarts is marked failed, never retried.

## Trust model

Whoever holds the database login in a Mac's `~/.claude-office/config.json` counts as the owner: that login can write orders the agent will run, with no check that the web wrote them. This is accepted because there is one owner, the Macs are their own, and the file is not shared. The agent still checks every order it claims against a schema and hires only into folders it listed itself, and a wake resumes in the folder the agent stored, so a malformed or invented row cannot inject shell syntax or open an arbitrary folder. A login per Mac, or orders signed by the web, would narrow this and is a later enhancement.

## Consequences

- Good: no new connection type; the poll fits the agent's existing timers and its write watchdog.
- Good: the same collection serves wake and dismiss orders now and stop orders later.
- Good: an offline Mac never runs a stale order, and the message does not stay in the database longer than about 10 minutes when no Mac picks it up.
- Bad: an order takes up to about a second to reach the Mac, and an idle poll costs one query a second per Mac.
- Bad: an agent older than the version that polls never claims orders, so the office must refuse orders for it (it reports its version with each heartbeat).
- Bad: a claim that is cut off before the window opens fails and the owner must click again.
- Rejected: MongoDB change streams. They push orders at once but add reconnect and resume handling to the agent for a gain of about a second.
