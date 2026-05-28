# @flow-state-dev/cli

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-01 — `fsdev run` as primary CLI dev loop (FIX-490)

`fsdev run` now emits `[flow-state] *` runtime events to stderr by default at `info` level — action lifecycle, block lifecycle, retries, errors. New `--quiet` and `--log-level <debug|info|warn|error>` flags. New `--capture <path>` writes the full structured run output to a JSON file (`{ command, events, result }`). The CLI always passes an explicit logger so the server's `console.*`-backed default never corrupts the NDJSON stream.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

CLI seed flags and resolved-flow contracts renamed `project` → `org` (`--seed-org`).

### 2026-04-11 — DevTool: `fsdev dev` command (FIX-261)

Added `fsdev dev` command — starts an HTTP dev server that serves both the flow API routes and the DevTool UI from a single port. Auto-discovers flows from conventional directories, registers them in an in-memory `FlowRegistry`, and creates filesystem stores at `.fsdev/data/`. Bridges Node.js `http` to the Web API `Request`/`Response` interface, with SSE streaming support. Options: `--port` (default 4200), `--flow-dir` (repeatable), `--model`, `--no-open`. `@flow-state-dev/devtool` listed as an optional peer dependency.

### 2026-03-09 — CLI: `fsdev run` (FIX-212)

Added `fsdev run <flowKind> <action>` for executing flow actions from the terminal with real-time NDJSON streaming to stdout. New `resolve-flow.ts` with `discoverFlows()` (`src/flows/`, `flows/`) and explicit `resolveFlow()`. NDJSON event types: `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`. Supports session reuse, model override, and state seeding via inline JSON or file.
