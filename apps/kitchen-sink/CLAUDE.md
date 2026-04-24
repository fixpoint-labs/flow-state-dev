# Kitchen Sink

Reference application for `@flow-state-dev`. Hosts one or more flows; the flagship is `chat-agent` in `flows/chat-agent/`.

Living under `apps/` (not `examples/`) because kitchen-sink is too large to serve as a pedagogical example — it integrates every subsystem (DevTool, skills, thinking style, advisor, patterns). Pedagogical snippets live in `examples/`.

## Commands

```bash
pnpm dev          # Build all packages, then start Next.js dev server
pnpm dev:watch    # Dev server with package rebuild watching
pnpm build        # Production build
pnpm test         # Run tests (builds testing package first)
pnpm test:watch   # Watch mode
```

## Layout

- `flows/chat-agent/` — flow-specific code (flow.ts, blocks, schemas, prompts). Exports `chatAgentFlow` (`kind: "chat-agent"`).
- `components/flow-state/` — shared item-renderer UI (installed from `@flow-state-dev/ui`).
- `components/chat-agent/` — chat-agent-specific renderers (e.g. `ChatAgentMessage`).
- `components/` (top level) — shared app UI (sidebar, mode selector, etc.).
- `app/page.tsx` — landing page that mounts chat-agent for now. When a second flow lands, this becomes a flow index.
- `lib/server.ts` — flow registry + API router setup.

To add a new flow: drop it under `flows/<name>/`, register it in `lib/server.ts`, and mount it from `app/<name>/page.tsx`.

## Capabilities

This app uses `defineCapability()` to bundle related resources, context formatters, and tools into reusable units.

- **`artifactsCapability`** (`flows/chat-agent/blocks/artifacts.ts`) — artifact resources + inventory context + read/write tools.
- **`featuresCapability`** (`flows/chat-agent/blocks/features-capability.ts`) — feature-flag-gated tool selection. Conditionally includes `bashCapability` (from `@flow-state-dev/tools/bash`) when the bash feature is enabled. When bash is available, it replaces `readArtifact`/`updateArtifact` as the single artifact creation path.
- **`bashCapability`** (framework: `createBashCapability()` from `@flow-state-dev/tools/bash`) — bash tool blocks + environment-aware context guidance. Adapts prompt based on provider config (network access, python, just-bash vs local).

Generators and pattern factories declare `uses: [featuresCapability]` — one line replaces manual tools/context/resources plumbing.

## UI Components: Upstream-First Convention

The `components/flow-state/` directory contains components installed from the `@flow-state-dev/ui` registry (`packages/ui/registry/components/`). These are **copies** — the kitchen-sink owns them, but the registry is the upstream source.

**When modifying any component in `components/flow-state/`:**

1. Make the change in `packages/ui/registry/components/` first (the upstream source)
2. Then apply the same change to the kitchen-sink copy in `components/flow-state/`

This ensures the registry stays in sync and other consumers get the fix when they next install.
