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
- Emission API: `ctx.emitMessage()`, `ctx.emitComponent()`, `ctx.emitStatus()`
- Sequencer DSL: `.then()`, `.thenIf()`, `.map()`, `.tap()`, `.rescue()`
- Session resources (`artifacts`) with typed resource reads/writes
- clientData on `session` and `user` scopes
- Action-level `userMessage` for automatic user message emission
- Lifecycle handling via `onCompleted`

Exported as `chatAgentFlow` (`kind: "chat-agent"`). Mounted at `/`.

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
