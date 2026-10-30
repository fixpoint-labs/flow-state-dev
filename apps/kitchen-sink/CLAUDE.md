# Kitchen Sink

Reference application for `@flow-state-dev`. Hosts one or more flows; the flagship is `chat-agent` in `flows/chat-agent/`.

Living under `apps/` (not `examples/`) because kitchen-sink is too large to serve as a pedagogical example — it integrates every subsystem (DevTool, skills, thinking style, advisor, workforce). Pedagogical snippets live in `examples/`.

## What belongs here, and what belongs in the framework

Kitchen Sink is glue. It assembles pieces the framework packages already ship into one app, and it should read as a clean example of how to do that. When a change needs new behaviour, the behaviour goes in the package that owns it, and Kitchen Sink picks it up with an import and a few lines of wiring.

**The test: would a second app that used the same piece need this code too?** If yes, it belongs in the framework. If it only makes sense for this app, it can stay here.

Belongs in Kitchen Sink:

- Registering flows, workers and modes, and mounting them on pages (`fsdev.config.ts`, `app/`, `lib/modes.ts`).
- Choosing among options a package exposes: which model intent, which store profile, which preset, which harness mode is on.
- Layout and composition of framework components into this app's screens.
- Demo content: the support team's `WORKER.md` files, prompts, the example flows' own schemas and blocks.
- This app's own tests and scripted test-mode fixtures that drive them.

Belongs in a framework package, not here:

- **Features.** New behaviour a user of the framework would want. Build it in the owning package, with its tests and README, then wire it here.
- **Knowledge about an outside tool.** Model lists, version pins, sign-in probes, parsing a CLI's output. The integration package owns these, because every app using that integration needs the same answer. Kitchen Sink may still decide whether one of its modes is on by composing those probes (`lib/harness-gate.ts`). Example: Codex mode kept a hand-written model list and parsed `codex login status` itself; #4035 moves both into `@flow-state-dev/codex`.
- **Workarounds.** If a package misbehaves, fix the package. A workaround here hides the bug from every other app and from the package's tests.
- **Custom config that should be a default.** If Kitchen Sink has to pass the same option every app would pass, change the package's default or add a preset.
- **Reusable UI.** See "UI Components: Upstream-First Convention" below.

If the framework change is too large for the task you're on, don't land the workaround here as a stopgap. Raise it as a scope decision (see `docs/contributing/asking-for-decisions.md`): build it in the package now, or file the package work and leave the Kitchen Sink side undone.

When you touch existing Kitchen Sink code that fails this test, say so in the PR. Move it if the move is small and in scope; otherwise name it as follow-up rather than adding to it.

## Commands

```bash
pnpm dev          # Next.js dev server (no package build step)
pnpm build        # Production build
pnpm test         # Run tests
pnpm test:watch   # Watch mode
```

`pnpm dev` runs `WATCHPACK_POLLING=true next dev`, setting Watchpack's polling
mode before Next loads its watcher. Workspace packages are consumed as TypeScript
source — their `package.json` `exports` point at `./src` in the workspace (the
built `./dist` is swapped in at publish time via `publishConfig`), and
`next.config.mjs` lists every workspace package in `transpilePackages`. So
editing a package shows up in the running app through Next's HMR with no
rebuild and no watcher. The old `tsc --build` / dist-watching dance (and the
`dev:fresh` / `dev:watch` scripts) are gone — there's no compiled `dist` in the
dev loop to fall out of sync.

Package builds (for typecheck, publish, and CI) run through Turborepo:
`pnpm packages:build` from the repo root. Turbo caches task output, so an
unchanged rebuild is a near-instant cache hit.

## Testing this app

Three layers, picked by the kind of change you made:

- **Flow logic changes** (blocks, sequencers, routers, capabilities, tool loops): `pnpm fsdev run chat-agent run -i '{"message":"hi","mode":"ask"}'` from the repo root. The command is `fsdev run <flowKind> <action>` — here the flow kind is `chat-agent` and the action is `run` (not `kitchen-sink chat-agent`, which would parse `kitchen-sink` as a non-existent flow kind). Use `--session <id>` to test multi-turn behavior, `--model <id>` to swap models, and `--capture <path>` to dump the full stream + result to a file. Stderr carries `[flow-state] *` runtime logs by default; pass `--quiet` to suppress.

  Kitchen-sink now ships an `fsdev.config.ts` (FIX-784), and `lib/flowstate.ts` re-exports it. The same command works both from the repo root (via directory discovery, with default stores and resolver) and from the app directory, where the config applies the app's real wiring — its intent ladder and gateway, its store profiles — instead of CLI defaults: `cd apps/kitchen-sink && pnpm fsdev run chat-agent run -i '{"message":"hi","mode":"ask"}'`. Config search is cwd-only.
- **Unit-level changes** (helpers, types, schemas): `pnpm --filter kitchen-sink test`.
- **UI changes** (renderers, streaming display, prompt input): `pnpm dev` then verify in the browser.

Don't mix these — the CLI is faster than the browser for everything below the UI layer, and skipping it is how component-composition bugs slip through.

## Layout

- `flows/chat-agent/` — flow-specific code, organized by-action: `flow.ts` (defineFlow only), `shared/` (schemas, capabilities, prompt loader), `run/` (the chat turn — assistant, thinking styles, cognition, bias check), and single-file root actions (`approval-gate.ts`, `task-queue-demo.ts`, `settings.ts`). The `saveArtifact` action is owned by the artifacts concern (`shared/artifacts/`) rather than a root file — artifacts is fundamentally a capability, so its resource, tools, context, and `saveArtifact` action live together as a concern folder with a thin `capability.ts` adapter. Prompts are co-located `*.prompt.md` templates. Exports `chatAgentFlow` (`kind: "chat-agent"`).
- `flows/rich-text-component/` — flow-specific code (flow.ts, generators, schemas, prompts, memory). Exports `richTextComponentFlow` (`kind: "rich-text-component"`). Non-agentic: 8 discrete text-transform actions. The `personalize` action reads user-scoped episodic + semantic memories captured by chat-agent. It only consumes memory, so it wires in `createMemoryCapability` (read-side) configured with the same tiers — not `system()` (no flow-isolation, so storage is shared by `userId`).
- `flows/weekly-digest/` — reference wiring for scheduled actions. One static schedule (`monday-summary`) plus a dynamic resource-collection resolver backed by `defineScheduleCollection` + `createPostgresScheduleIndex`. The `scheduleDigest` action lets a caller add per-user dynamic schedules at runtime.
- `components/flow-state/` — shared item-renderer UI (installed from `@flow-state-dev/ui`).
- `components/background-work-panel.tsx` — the child-session panel (see "Background work" below).
- `components/chat-agent/` — chat-agent-specific renderers (e.g. `ChatAgentMessage`).
- `components/` (top level) — shared app UI (team panel, mode selector, etc.). The Flow State rail is `FlowNavigator` from `@flow-state-dev/react`, mounted in `app/flow-state/page.tsx`; the names it and the team panel share with the flow live in `lib/workforce-shell.ts`.
- `app/page.tsx` — the picker: Kitchen Sink's four modes (`lib/modes.ts`), each available or unavailable with its reason. A server component rendered per request, reading `modeAvailability()`.
- `app/flow-state/page.tsx` — the Flow State shell (today's app): the assistant, the support desk, the roster. Its rail's first row is `components/mode-rail-header.tsx`, the way back to the picker.
- `app/claude-code/`, `app/codex/`, `app/cursor/` — the coding harness modes' addresses, each `components/harness-mode-page.tsx`: the reason page when the mode is unavailable, else `components/harness-mode-view.tsx`, which puts `components/harness-session.tsx` (the conversation, the turn's notice, the read-only plan panel) in the stream slot of `components/harness-frame.tsx` (a rail of the mode's own flow kind's sessions as one flat list, `components/harness-session-list.tsx`, with New session).
- `lib/harness-session-flow.ts` — Kitchen Sink's wiring of `@flow-state-dev/harness-manager`'s `harnessSessionFlow`, the one session flow every harness mode uses (a deferred `turn` action, a `steer` action, the bound conversation, a record per turn, a session born with its model). Kitchen Sink supplies where a session works (`lib/harness-worktree.ts`, from `lib/harness-workspace.ts`) and its goal controls, each wrapped around one feed. `lib/harness-turn.ts` (browser-safe) reads the package's turn record for the notice and the plan panel; `lib/harness-models.ts` holds what each mode's New session offers. A mode supplies only its block (`lib/claude-code-mode.ts`, `lib/codex-mode.ts`, `lib/cursor-mode.ts`).
- `lib/harness-worktree.ts` — one git worktree and branch per session, through `@flow-state-dev/workspace`, under `${XDG_STATE_HOME:-~/.local/state}/flow-state-dev/kitchen-sink-harness/`. Never cleared.
- `lib/claude-code-mode.ts` — Claude Code mode: its block (no sandbox, `bypassPermissions`, allowlisted env, `settingSources: []`) and its own availability check (not root, worktree root, SDK + sign-in). Under `KITCHEN_SINK_TEST_MODE=1` the SDK is `lib/scripted-claude-code.ts`, whose prompt directives (`[slow]`, `[plan]`, `[refuse]`, …) drive the e2e; `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one.
- `lib/cursor-mode.ts` — Cursor mode: its block's options (`recordPlan`, agent mode, `composer-2.5` as `CURSOR_DEFAULT_MODEL`, Cursor's sandbox off, the allowlisted `env`, so the Cursor package runs the runtime in its own process) and its own availability check (the pinned SDK, a process that starts with only that env, a key or stored login). Under `KITCHEN_SINK_TEST_MODE=1` the SDK is `lib/scripted-cursor.ts` (directives `[plan]`, `[slow]`, `[refuse]`, …) with `env` unset; `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one.
- `lib/codex-mode.ts` — Codex mode: its block's options (`danger-full-access` with no approvals, the allowlisted `client.env`, and no plan record, so the panel says "Codex reports no plan") and its own availability check (the pinned SDK through the Codex package's own version gate, and a sign-in through the Codex package's own `probeCodexAccount`: `CODEX_API_KEY` or `codex login status`). New session's list is Codex's own, read with the Codex package's `listCodexModels` (`codexModelChoices`), Codex's default preselected; a list that can't be read offers nothing and says why. Sessions with no saved model run Codex's listed default; when the list can't be read their turn fails with the reason rather than start a run with no model. `codexClientOptions` supplies the default service tier and disables discovered MCP servers with valid command or URL transport overrides, leaving personal `config.toml` unchanged. The first turn reads the MCP inventory with `codex mcp list` and caches it for the server process; restart after inventory changes. Discovery failures warn that configured servers may start and retry on the next turn. Under `KITCHEN_SINK_TEST_MODE=1` the SDK is `lib/scripted-codex.ts` (directives `[slow]`, `[slow-start]`, `[refuse]`, `[new]`, `[fail]`, `[fail-early]`, `[refused-model]`); `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one.
- `lib/harness-gate.ts` — whether each mode can run on this host, decided once per server start (memoized on `globalThis`) and read by the picker, the harness addresses and the flow list alike. Order: host (`lib/harness-workspace.ts`, the one reader of `KITCHEN_SINK_HARNESS_WORKSPACE`), then "not built yet" (no `flowKind` in `lib/modes.ts`), then the mode's own check (`MODE_CHECKS`). A harness mode registers its flow in `fsdev.config.ts` only through `availableHarnessFlows`, so an unavailable mode's `/api/flows/<kind>/…` is not found. Goal control `gate-open` skips the host and each mode's own check in a test-mode build.
- `lib/flowstate.ts` — re-exports the FlowState from `fsdev.config.ts` (which holds the `createFlowState` runtime assembly: flows, model intents, voice, store profiles, error sink). The reference setup for the FlowState API, now shared with the `fsdev` CLI via the root config.

To add a new flow: drop it under `flows/<name>/`, register it in `fsdev.config.ts`, and mount it from `app/<name>/page.tsx`.

## Capabilities

This app uses `defineCapability()` to bundle related resources, context formatters, and tools into reusable units.

- **`artifactsCapability`** (`flows/chat-agent/shared/artifacts/`) — artifact resources + inventory context + read/write tools. Artifacts is a **concern folder**, not a single file: `resource.ts` → `tools.ts` / `context.ts` → `capability.ts` (a thin adapter), with one-way deps and `index.ts` as the public surface. The `saveArtifact` action sequencer (`updateArtifact`) that `flow.ts` wires lives in `tools.ts`.
- **`featuresCapability`** (`flows/chat-agent/shared/capabilities/features.ts`) — feature-flag-gated tool selection. Conditionally includes `bashCapability` (from `@flow-state-dev/tools/bash`) when the bash feature is enabled. When bash is available, it replaces `readArtifact`/`updateArtifact` as the single artifact creation path.
- **`bashCapability`** (framework: `createBashCapability()` from `@flow-state-dev/tools/bash`) — bash tool blocks + environment-aware context guidance. Adapts prompt based on provider config (network access, python, just-bash vs local).

Generators and pattern factories declare `uses: [featuresCapability]` — one line replaces manual tools/context/resources plumbing.

## Prompt templates: data prep stays in TS

When a generator's `user:` (or `<system>`) prompt needs to format structured
input, author the layout in a `.prompt.md` `<user>` block and keep the
shape-handling in a typed TS **view builder** registered as a Liquid filter —
pass `{ filters }` to `createPromptLoader` in `shared/prompts.ts`. The template
is then pure layout over `{{ input | someView }}`, and the builder does the
`unknown`-shape discrimination and any fallbacks in type-checked code.

The engine renders under `strictVariables`, so a template that reads an absent
optional field directly (`{{ input.feedback }}` with no feedback) throws. The
view builder dodges this by returning an object whose keys are **always present**
— `null` when absent — so `{% if %}` guards never touch an undefined variable.
Add a rendered value by adding a field to the view + a line in the template.

**No filter is registered today.** The one this app had built the supervisor
worker's view, and it went with the coordination-pattern pipelines removed in
FIX-1478. The convention stands; the next prompt that needs structured input is
where it comes back.

## Background work (child sessions) demo

The **Background Work** thinking style is the app's child-session reference. A turn
files the message as a durable task, hands it to a child session — one
that outlives the request — and replies without waiting. A later turn reports
what came back.

- Flow: `flows/chat-agent/run/thinking-styles/pipelines/background-work.ts`.
  Durable ledger (`defineTaskCollection`, session-scoped, `sharedToLineage:
  true`), an explicit `boardId`, and one worker holding a
  `dispatcher({ action, session: { key } })` so tasks that share a topic
  share one child session. The block that runs there (`briefWorker`) is exported
  as the task entry `backgroundWorkTasks` and declared on the flow as
  `task: { actions: backgroundWorkTasks }` (`flows/chat-agent/flow.ts`) —
  `defineFlow` gates it behind the board and refuses the flow without it.
- UI: `components/background-work-panel.tsx`, mounted above the prompt input.
  Reads `session.childSessions` / `session.childSessionsStale` and opens one
  child session with `useSession(childSessionId, { flowKind: "chat-agent" })` — the
  **parent's** flow kind, because that is what a child session is stamped with.
- E2E: `e2e/background-work.spec.ts`, with `background-brief` mocked in
  `lib/e2e-mock-script.ts`.

Two behaviours to know before changing it:

- **The turn cannot observe its own hand-off settling.** The board view a request
  hydrates never sees the child session's write, so polling for completion inside
  the turn would wait forever. Results surface on a later turn.
- **A generator in a child session streams no in-flight text.** Its history
  fills in with completed items only.

## Scheduled actions demo

The `weekly-digest` flow is the live reference for the docs in
`apps/docs/docs/server/scheduled.md` and `…/schedule-index.md`. Two
Vercel cron routes drive it (`vercel.json`):

- `GET /api/cron/static/[scheduleId]` — Vercel Cron → POST shim for static schedules.
- `GET /api/cron/schedule-tick` — 15-minute polling tick that claims due rows from the `ScheduleIndex` and fans out dispatches.

Env vars required at runtime: `CRON_SECRET` (shared bearer between cron
routes and the dispatch endpoint) and `NEXT_PUBLIC_BASE_URL` (deployment
URL the shims POST back into). The index lives in Postgres alongside
the rest of the stores, so `FSD_DB_URL` / `DATABASE_URL` is required too.

Profile selection: `lib/flowstate.ts` declares a `prod` (Postgres) and a
`dev` (SQLite, `.fsdev/data/flowstate.db`) store profile. It defaults to `prod` whenever a database
URL (`FSD_DB_URL` / `DATABASE_URL`) is configured — the deployed/Vercel case —
and to `dev` otherwise (local dev with no DB). Set `FSD_ENV=prod` / `FSD_ENV=dev`
to override the default explicitly. The scheduler index only resolves under
`prod`, so the cron tick no-ops without a Postgres profile.

## UI Components: Upstream-First Convention

The `components/flow-state/` directory contains components installed from the `@flow-state-dev/ui` registry (`packages/ui/registry/components/`). These are **copies** — the kitchen-sink owns them, but the registry is the upstream source.

**When modifying any component in `components/flow-state/`:**

1. Make the change in `packages/ui/registry/components/` first (the upstream source)
2. Then apply the same change to the kitchen-sink copy in `components/flow-state/`

This ensures the registry stays in sync and other consumers get the fix when they next install.
