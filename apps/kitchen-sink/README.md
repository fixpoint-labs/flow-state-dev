# Kitchen Sink

The canonical reference application for `@flow-state-dev`. A full Next.js app demonstrating every framework building block with a polished UI built on [Vercel AI Elements](https://sdk.vercel.ai/docs/ai-sdk-ui/ai-elements) and [shadcn/ui](https://ui.shadcn.com).

Kitchen sink is a reference app, not a minimal example. It hosts multiple flows, integrates every subsystem (DevTool, skills, thinking style, advisor, patterns), and is the place we test new features end-to-end. For small, focused, copy-paste-able demos see `examples/`.

## Flows

### `chat-agent` (`flows/chat-agent/`)

A multi-modal AI assistant — the flagship flow. Showcases:

- `defineFlow` with `session` and `user` scope state
- All 4 block kinds: `handler`, `generator`, `router`, `sequencer`
- Router decisions from both action input and `ctx.session.state`
- Generator tool loop with handler-backed tools (`readArtifact`, `updateArtifact`)
- Generator slots: `prompt`, `context`, `history`, `user`
- Emission API: `ctx.emit.message()`, `ctx.emit.component()`, `ctx.emit.status()`
- Sequencer DSL: `.step()`, `.stepIf()`, `.map()`, `.tap()`, `.rescue()`
- Session resources (`artifacts`) with typed resource reads/writes
- clientData on `session` and `user` scopes
- Action-level `userMessage` for automatic user message emission
- Lifecycle handling via `onCompleted`

Exported as `chatAgentFlow` (`kind: "chat-agent"`). Mounted at `/`.

### `rich-text-component` (`flows/rich-text-component/`)

Non-agentic flow demonstrating component-level AI features: 8 discrete single-shot text transformations. Shows that `defineFlow` scales down to the simplest case — input → single generator → streamed text.

Actions:
- `copyedit` — fix grammar/spelling/punctuation; preserve voice
- `improve` — clarity/flow/impact; preserve meaning
- `changeTone` — rewrite in a specified tone
- `translate` — translate into a target language (preserves code fences)
- `summarize` — condense at `short` | `medium` | `long` length
- `expand` — elaborate, optionally guided by context
- `fixCode` — fix syntax/logic in code (with optional language hint)
- `personalize` — weave user-specific details into the text using user-scoped episodic + semantic memories captured by `chat-agent` (shared via the same `userId` storage key)

Exported as `richTextComponentFlow` (`kind: "rich-text-component"`). Consumed by the artifact editor UI. Not mounted at a dedicated route.

## Web Application (`app/`)

- Three-column layout: session sidebar, conversation, artifact panel
- **AI Elements**: Conversation, Message (with Streamdown markdown), Reasoning, Tool, Suggestion, Shimmer, PromptInput
- **Bridge components**: Map flow-state item types (`MessageItem`, `ReasoningItem`, `BlockOutputItem`, `StatusItem`, `ErrorItem`) to AI Element visuals
- **Client data bar**: Live display of mode status, request count, user preferences
- **Mode selector**: Chat / Plan / Review tabs that feed into `sendAction`
- **Session management**: Create, list, and switch between sessions
- **Tool call visualization**: Inline display of tool invocations with args + output via AI Elements Tool component
- **Streaming indicators**: PromptInputSubmit status, Shimmer for status items, skeleton cards for in-progress blocks

## Testing (`test/`)

- `testFlow` and `testBlock` for flow-level and block-level tests
- `testRouter` for router decision testing
- Seeded state and resources
- Item type and content assertions

## Setup

1. Install dependencies from the monorepo root:

```bash
pnpm install
```

2. Copy the environment template and add your OpenAI API key:

```bash
cp apps/kitchen-sink/.env.local.example apps/kitchen-sink/.env.local
# Edit .env.local and set OPENAI_API_KEY
```

3. Start the dev server:

```bash
pnpm --filter @flow-state-dev/kitchen-sink dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Environment variables

Most env vars are optional with sensible defaults. The ones below change behavior on a deployed environment.

### Bash tool provider

| Variable | Effect |
|--|--|
| `BASH_PROVIDER` | Forces a specific sandbox adapter. Values: `vercel`, `just-bash`, `local`, `moat`. Unset for auto-detect (Vercel Sandbox if credentials are present, otherwise `just-bash`). |
| `VERCEL_TOKEN` | Static access-token credential for `@vercel/sandbox`. Operator must set on Vercel for non-OIDC auth. |
| `VERCEL_TEAM_ID` | Vercel team identifier. Operator must set on Vercel for non-OIDC auth. |

`VERCEL_PROJECT_ID` is also checked but is a [Vercel system environment variable](https://vercel.com/docs/environment-variables/system-environment-variables) — it's auto-injected on every Vercel deployment, so you don't need to add it manually.

On Vercel without any of the variables above, the kitchen-sink falls back to `just-bash` — an in-memory virtual filesystem with ~70 commands and optional Python/JS interpreters. Files written by the agent live for the duration of one request; commands run without a real shell. This makes the deployed demo work for anonymous visitors with zero operator setup.

To enable real Vercel Sandbox microVMs on a deployment, configure either OIDC Federation on the Vercel project (then set `BASH_PROVIDER=vercel`) or both `VERCEL_TOKEN` and `VERCEL_TEAM_ID`. Full recipe in the [Deploying to Vercel guide](https://flow-state-dev.com/guides/deploying-to-vercel#7-using-the-bash-tool-on-vercel).

```bash title=".env.production (excerpt — uncomment one path)"
# Path A: OIDC Federation
# BASH_PROVIDER=vercel

# Path B: static access token (auto-detected, no BASH_PROVIDER needed)
# VERCEL_TOKEN=...
# VERCEL_TEAM_ID=team_...
```

## Verification

```bash
# Run tests
pnpm --filter @flow-state-dev/kitchen-sink test

# Production build (includes TypeScript type checking)
pnpm --filter @flow-state-dev/kitchen-sink build
```

## Architecture

```
apps/kitchen-sink/
  app/                       Next.js App Router
    page.tsx                 Landing — mounts chat-agent
    layout.tsx               Root layout with Inter font
    api/flows/               Flow API routes (SSE streaming)
  flows/
    chat-agent/              Flow-specific code
      index.ts               Barrel: chatAgentFlow + blocks
      flow.ts                Flow definition (source of truth)
      schemas.ts             Shared Zod schemas
      prompts.ts             Mode prompts
      blocks/                Individual block definitions
  components/
    flow-state/              Shared item-renderer UI (installed from @flow-state-dev/ui)
    chat-agent/              chat-agent-specific renderers
    ui/                      shadcn/ui primitives
    ...                      Shared app UI (sidebar, mode selector, etc.)
  lib/
    server.ts                Flow registry + API router setup
    mcp.ts                   Optional MCP capability (env-gated)
    utils.ts                 cn() utility
  skills/                    Bundled skill markdown
  test/                      Vitest test suite
```

Additional flows live alongside `chat-agent/` under `flows/` and mount at their own route under `app/`.
