# Example: Kitchen Sink

The canonical reference application for `@flow-state-dev`. A full Next.js app demonstrating every framework building block with a polished UI built on [Vercel AI Elements](https://sdk.vercel.ai/docs/ai-sdk-ui/ai-elements) and [shadcn/ui](https://ui.shadcn.com).

## Features

### Flow Definition (`src/flows/kitchen-sink/`)

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

### Web Application (`app/`)

- Three-column layout: session sidebar, conversation, artifact panel
- **AI Elements**: Conversation, Message (with Streamdown markdown), Reasoning, Tool, Suggestion, Shimmer, PromptInput
- **Bridge components**: Map flow-state item types (`MessageItem`, `ReasoningItem`, `BlockOutputItem`, `StatusItem`, `ErrorItem`) to AI Element visuals
- **Client data bar**: Live display of mode status, request count, user preferences
- **Mode selector**: Chat / Plan / Review tabs that feed into `sendAction`
- **Session management**: Create, list, and switch between sessions
- **Tool call visualization**: Inline display of tool invocations with args + output via AI Elements Tool component
- **Streaming indicators**: PromptInputSubmit status, Shimmer for status items, skeleton cards for in-progress blocks

### Testing (`test/`)

- `testFlow` and `testBlock` for flow-level and block-level tests
- `testRouter` for router decision testing
- Seeded state and resources
- Item type and content assertions
- 12 tests covering all block kinds and integration scenarios

## Setup

1. Install dependencies from the monorepo root:

```bash
pnpm install
```

2. Copy the environment template and add your OpenAI API key:

```bash
cp examples/kitchen-sink/.env.local.example examples/kitchen-sink/.env.local
# Edit .env.local and set OPENAI_API_KEY
```

3. Start the dev server:

```bash
pnpm --filter @flow-state-dev/example-kitchen-sink dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Verification

```bash
# Run all 12 tests
pnpm --filter @flow-state-dev/example-kitchen-sink test

# Production build (includes TypeScript type checking)
pnpm --filter @flow-state-dev/example-kitchen-sink build
```

## Architecture

```
kitchen-sink/
  app/                    # Next.js App Router
    page.tsx              # Main page: FlowProvider + three-column layout
    layout.tsx            # Root layout with Inter font
    api/flows/            # Flow API routes (SSE streaming)
  components/             # UI components
    kitchen-sink-*.tsx    # Bridge: flow-state items -> AI Elements
    agent-response-card   # Dispatches block_output to tool-call or structured output
    session-sidebar       # Session list + creation
    mode-selector         # Chat/Plan/Review tabs
    projections-bar       # Live client data display
    artifact-panel        # Right sidebar artifact list
    suggestion-row        # Quick action chips
    ui/                   # shadcn/ui primitives
  src/
    components/
      ai-elements/        # Vercel AI Elements (installed via CLI)
    flows/kitchen-sink/
      flow.ts             # Flow definition (the source of truth)
      schemas.ts          # Shared Zod schemas
      blocks/             # Individual block definitions
  lib/
    server.ts             # Flow registry + API router setup
    utils.ts              # cn() utility
  test/                   # Vitest test suite
```
