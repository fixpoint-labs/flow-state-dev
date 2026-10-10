# @flow-state-dev/fsdev

## 0.3.0

### Minor Changes

- b75c1ed: `fsdev run` and `fsdev chat` now run as whoever the app's resolver names (new `FlowState.resolveInProcessPrincipal`, with `source: "cli"` reserved for it), stop with exit 2 before writing anything when that resolver or a seat's pin refuses the terminal (a `--session` owned by another user or organization now also exits 2 instead of 1), and take `--org`/`--user` to name the identity locally (FIX-1551).
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- a600325: `fsdev gen` no longer depends on `@flow-state-dev/workforce`. It runs the generator a dependency of the app exports on a `./fsdev-gen` subpath (typed as `FsdevGenerator`), and `@flow-state-dev/workforce` now exports its generator there, so a Workforce app runs `fsdev gen` as before. `GenResult` reports `generator`, `entries`, `paths` and `summary` in place of the Workforce discovery lists, and `--root` defaults to the generator's own folder (FIX-1771).
- e9f9316: `fsdev gen` now finds the blocks in every package's `blocks/` folder and writes them to a new `packageBlocks` export, so `fsdev gen --check` reports a generated file that predates them as out of date (FIX-1459).
- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- b808784: Channels are now mailboxes everywhere (`MAILBOX.md` under `teams/<team>/mailboxes/`, the `mailbox` kind, `mailbox-post` items, the `post-to-mailbox` tool, the `mailboxes` discovery domain, and every export, such as `mailboxFlow`), and the old names are not read, so an old file is reported by name and a store written before this release does not open: start from an empty store (FIX-1748).
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).

### Patch Changes

- 204860e: `declaredDevtoolConfig(flowState)` is now exported: the `devtool` block (user and bearer) an app's `fsdev.config.*` declares, or `undefined` when the block is empty, exactly as `fsdev dev` reads it. A host that serves its own pages through `serve()` can hand the same config to them (FIX-1662).
- 7f892f6: `fsdev dev` gains `--app <package|dir>`, which serves an app's built pages at the root of the port beside the flow API and moves the DevTool to a port of its own, handing each page its address as the `fsdev-devtool-url` meta; and `--host` with `--allow-unauthenticated`, where a non-loopback host runs `fsdev serve`'s authentication check, refuses a config that hands its page a bearer token, and keeps the debug surface closed. `--port` now refuses a value that isn't a whole number, and `executeDevCommand` resolves with a handle to close the server (FIX-1770).
- 9cc903f: `fsdev dev --app` also takes the path of a package's module file, `locateConfig` is exported so a wrapping command finds the config the way `fsdev dev` does, and a `--watch` restart exits after at most 3 seconds instead of waiting on runs still going (FIX-1770).
- 83c48a7: `fsdev dev` gains `--watch`: the server restarts on the same port when a file the config loaded, or a file in the config's folder, is saved, and the pages open on it reload by themselves; a failed restart waits for the next save, and it binds loopback only. With `--app`, a package that also exports `getSourceRoot()` is served from that folder through the Vite its own install resolves, falling back to its built pages (FIX-1770).
- 82ec64e: `fsdev ui add a b c` installs every component in one shadcn call. It used to call shadcn once per component, so a later component that shared a dependency with an earlier one stopped at an overwrite prompt for the file the earlier call had just written (FIX-1655).
- 65ddb90: Each request's record now stores its action result (`output` as JSON, and/or `error`) with its final status, `listSessionRequests` returns it (the output with `includeResultOutput`), the DevTool task row reads it instead of reconstructing it from traces, and a run a completion hook failed after the action answered now reports that answer as `output` (including `fsdev run`'s result, where it was `null`) (FIX-1661).
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [be1bddf]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [53b50f0]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [b75c1ed]
- Updated dependencies [698e06b]
- Updated dependencies [25ac53a]
- Updated dependencies [456fe85]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [9d02ac6]
- Updated dependencies [55c62a6]
- Updated dependencies [8dc242e]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [7d4158f]
- Updated dependencies [a3bfbc2]
- Updated dependencies [f469423]
- Updated dependencies [099906a]
- Updated dependencies [5902deb]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [49d6397]
- Updated dependencies [bb1c224]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [423a405]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [21ffcbb]
- Updated dependencies [5a55080]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [b808784]
- Updated dependencies [b2d2679]
- Updated dependencies [bb16f3a]
- Updated dependencies [7f892f6]
- Updated dependencies [83c48a7]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [db7df1c]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [6a3ecf5]
- Updated dependencies [839e915]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
- Updated dependencies [47a02d0]
- Updated dependencies [e0f10e2]
- Updated dependencies [9083569]
- Updated dependencies [9510a03]
- Updated dependencies [0935a47]
- Updated dependencies [d2f77fc]
- Updated dependencies [0995afe]
- Updated dependencies [d9d00a4]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [385d01e]
- Updated dependencies [83cd9c2]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
- Updated dependencies [8b8ba8d]
- Updated dependencies [97894aa]
- Updated dependencies [3c2ab06]
- Updated dependencies [334c1e3]
- Updated dependencies [64b3ed7]
- Updated dependencies [92a8b49]
- Updated dependencies [9ed6b29]
- Updated dependencies [9f32967]
- Updated dependencies [b7c523b]
- Updated dependencies [b7c523b]
- Updated dependencies [6bf61dc]
- Updated dependencies [a021cd1]
- Updated dependencies [8f5277e]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [2c43888]
- Updated dependencies [9cd314d]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [5f9980c]
- Updated dependencies [387f95c]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [84cc226]
  - @flow-state-dev/engine@0.3.0
  - @flow-state-dev/store-sqlite@0.3.0
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/node@0.1.4
  - @flow-state-dev/devtool@0.3.0
  - @flow-state-dev/testing@0.3.0

## 0.2.0

### Minor Changes

- 17e9748: Workers can call custom tools written as files. A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes.

  Migration: a worker kind that hand-declares the admission contract instead of composing `workerConfigSchema()` must add the new `seatTools` key, or it refuses its roster at startup naming that key (FIX-1416).

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

- 8bfb08c: `fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

  **Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

  `renderWorkforceCode` takes the discovered modules as a second argument.

### Patch Changes

- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [68fb69c]
- Updated dependencies [17e9748]
- Updated dependencies [0508765]
- Updated dependencies [795b550]
- Updated dependencies [9062055]
- Updated dependencies [802c053]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [4cd4f13]
- Updated dependencies [d49f255]
- Updated dependencies [1a3a009]
- Updated dependencies [8291951]
- Updated dependencies [b48158a]
- Updated dependencies [0056b97]
- Updated dependencies [f7e98d9]
- Updated dependencies [f25f03c]
- Updated dependencies [8bfb08c]
- Updated dependencies [c315362]
- Updated dependencies [68d836a]
- Updated dependencies [e4c443e]
- Updated dependencies [caffe1c]
- Updated dependencies [bff5e06]
- Updated dependencies [e4b6576]
  - @flow-state-dev/workforce@0.3.0
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/devtool@0.2.0
  - @flow-state-dev/engine@0.2.0
  - @flow-state-dev/testing@0.2.0
  - @flow-state-dev/store-sqlite@0.2.0
  - @flow-state-dev/node@0.1.3

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
