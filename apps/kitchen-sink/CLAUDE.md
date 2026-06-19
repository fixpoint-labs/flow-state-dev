# Kitchen Sink

Reference application for `@flow-state-dev`. Hosts one or more flows; the flagship is `chat-agent` in `flows/chat-agent/`.

Living under `apps/` (not `examples/`) because kitchen-sink is too large to serve as a pedagogical example — it integrates every subsystem (DevTool, skills, thinking style, advisor, patterns). Pedagogical snippets live in `examples/`.

## Commands

```bash
pnpm dev          # Next.js dev server (no package build step)
pnpm build        # Production build
pnpm test         # Run tests
pnpm test:watch   # Watch mode
```

`pnpm dev` is just `next dev`. Workspace packages are consumed as TypeScript
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

- `flows/chat-agent/` — flow-specific code, organized by-action: `flow.ts` (defineFlow only), `shared/` (schemas, context, capabilities, prompt loader), `run/` (the chat turn — assistant, thinking styles, cognition, bias check), and single-file root actions (`save-artifact.ts`, `approval-gate.ts`, `task-queue-demo.ts`, `settings.ts`). Prompts are co-located `*.prompt.md` templates. Exports `chatAgentFlow` (`kind: "chat-agent"`).
- `flows/rich-text-component/` — flow-specific code (flow.ts, generators, schemas, prompts, memory). Exports `richTextComponentFlow` (`kind: "rich-text-component"`). Non-agentic: 8 discrete text-transform actions. The `personalize` action reads user-scoped episodic + semantic memories captured by chat-agent. It only consumes memory, so it wires in `createMemoryCapability` (read-side) configured with the same tiers — not `system()` (no flow-isolation, so storage is shared by `userId`).
- `flows/weekly-digest/` — reference wiring for scheduled actions. One static schedule (`monday-summary`) plus a dynamic resource-collection resolver backed by `defineScheduleCollection` + `createPostgresScheduleIndex`. The `scheduleDigest` action lets a caller add per-user dynamic schedules at runtime.
- `components/flow-state/` — shared item-renderer UI (installed from `@flow-state-dev/ui`).
- `components/chat-agent/` — chat-agent-specific renderers (e.g. `ChatAgentMessage`).
- `components/` (top level) — shared app UI (sidebar, mode selector, etc.).
- `app/page.tsx` — landing page that mounts chat-agent for now. When a second flow lands, this becomes a flow index.
- `lib/flowstate.ts` — re-exports the FlowState from `fsdev.config.ts` (which holds the `createFlowState` runtime assembly: flows, model intents, voice, store profiles, error sink). The reference setup for the FlowState API, now shared with the `fsdev` CLI via the root config.

To add a new flow: drop it under `flows/<name>/`, register it in `fsdev.config.ts`, and mount it from `app/<name>/page.tsx`.

## Capabilities

This app uses `defineCapability()` to bundle related resources, context formatters, and tools into reusable units.

- **`artifactsCapability`** (`flows/chat-agent/shared/capabilities/artifacts.ts`) — artifact resources + inventory context + read/write tools.
- **`featuresCapability`** (`flows/chat-agent/shared/capabilities/features.ts`) — feature-flag-gated tool selection. Conditionally includes `bashCapability` (from `@flow-state-dev/tools/bash`) when the bash feature is enabled. When bash is available, it replaces `readArtifact`/`updateArtifact` as the single artifact creation path.
- **`bashCapability`** (framework: `createBashCapability()` from `@flow-state-dev/tools/bash`) — bash tool blocks + environment-aware context guidance. Adapts prompt based on provider config (network access, python, just-bash vs local).

Generators and pattern factories declare `uses: [featuresCapability]` — one line replaces manual tools/context/resources plumbing.

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
`dev` (in-memory) store profile. It defaults to `prod` whenever a database
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
