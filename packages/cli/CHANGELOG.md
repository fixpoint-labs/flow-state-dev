# @flow-state-dev/fsdev

## 0.2.0

### Minor Changes

- 17e9748: Workers can call custom tools written as files. A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes.

  Migration: a worker kind that hand-declares the admission contract instead of composing `workerConfigSchema()` must add the new `seatTools` key, or it refuses its roster at startup naming that key (FIX-1416).

- 8bfb08c: `fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

  **Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

  `renderWorkforceCode` takes the discovered modules as a second argument.

### Patch Changes

- Updated dependencies [8faf08e]
- Updated dependencies [68fb69c]
- Updated dependencies [17e9748]
- Updated dependencies [0508765]
- Updated dependencies [4cd4f13]
- Updated dependencies [d49f255]
- Updated dependencies [1a3a009]
- Updated dependencies [8291951]
- Updated dependencies [f7e98d9]
- Updated dependencies [8bfb08c]
- Updated dependencies [caffe1c]
- Updated dependencies [bff5e06]
  - @flow-state-dev/workforce@0.3.0
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/devtool@0.1.3
  - @flow-state-dev/engine@0.1.3
  - @flow-state-dev/node@0.1.3
  - @flow-state-dev/store-sqlite@0.1.3
  - @flow-state-dev/testing@0.1.3

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/devtool@0.1.2
  - @flow-state-dev/engine@0.1.2
  - @flow-state-dev/node@0.1.2
  - @flow-state-dev/store-sqlite@0.1.2
  - @flow-state-dev/testing@0.1.2
  - @flow-state-dev/workforce@0.2.1

## 0.1.1

### Patch Changes

- 2b728c2: Custom flow kinds and blocks now register from the file tree: `fsdev gen` walks `workforce/flows/workers/`, `workforce/flows/channels/` and `workforce/blocks/` and writes a committed module exporting the `kinds`, `channelKinds` and `blocks` maps that `hireWorkforce`, `channelInstances` and a task board already take, so adding one no longer needs a startup line (FIX-1357).
- Updated dependencies [7c52923]
- Updated dependencies [cee0c62]
- Updated dependencies [8270f00]
- Updated dependencies [efd4981]
- Updated dependencies [3c15e14]
- Updated dependencies [d195a90]
- Updated dependencies [33c8d10]
- Updated dependencies [2b728c2]
- Updated dependencies [a8e22c4]
- Updated dependencies [bbecd2d]
- Updated dependencies [23bc757]
- Updated dependencies [119936d]
- Updated dependencies [2f74e07]
- Updated dependencies [7986a48]
- Updated dependencies [8a1173a]
- Updated dependencies [70f787e]
- Updated dependencies [f9a3626]
- Updated dependencies [af6d6b9]
- Updated dependencies [d46fb72]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/workforce@0.2.0
  - @flow-state-dev/devtool@0.1.1
  - @flow-state-dev/engine@0.1.1
  - @flow-state-dev/node@0.1.1
  - @flow-state-dev/store-sqlite@0.1.1
  - @flow-state-dev/testing@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0
  - @flow-state-dev/devtool@0.1.0
  - @flow-state-dev/store-sqlite@0.1.0
  - @flow-state-dev/node@0.1.0
  - @flow-state-dev/testing@0.1.0

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
