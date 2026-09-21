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

### The support team (`workforce/`)

A hired team, declared in files rather than wired in code. Each seat is a `WORKER.md` under `workforce/teams/support/workers/`, and its frontmatter is the whole of its configuration — which flow kind it runs, and the settings that kind offers. `support.ada` and `support.grace` both run the `desk-clerk` kind and declare different desks; `support.iris` and `support.otto` run the built-in agent kind with different tools.

Worker kinds, blocks and capabilities are picked up the same way: a file under `workforce/flows/workers/`, `workforce/blocks/` or a `resources/` folder becomes an entry in `workforce/workforce.gen.ts` when you run `fsdev gen`. That generated module is committed, so the *code* an app can run is fixed when you run the command — no code is discovered while the app runs, which is what lets a bundler see it.

The roster is the other half, and it is read at boot: `hireKitchenSinkWorkforce()` walks `workforce/teams/` and hires a seat per `WORKER.md`. So the kinds are decided at generate time and the seats at startup — which is why adding a kind takes `fsdev gen` and adding a seat takes only a restart.

Each seat is addressed by its own id, so a seat answers on the same route as any other flow:

```bash
# A note to the front desk, from the CLI
pnpm fsdev run support.ada answer -i '{"note":"is the printer fixed?"}'

# Or over HTTP
curl -X POST localhost:3000/api/flows/support.ada/actions/answer \
  -H 'content-type: application/json' \
  -d '{"input":{"note":"is the printer fixed?"},"userId":"you"}'
```

Adding a seat means adding a folder and restarting; adding a kind means adding a file and re-running `fsdev gen`. There is no second place to edit.

Seats can also be hired while the app is running, which is the other half of the demonstration. `support.ada` and the rest are declared in files. A seat hired over `workforce-admin`'s `hire` action is written to the database instead, addressed with its organization (`acme.support.ada`), and is still there after `pnpm build && pnpm start`.

The admin flow is **not registered at all** unless `WORKFORCE_ADMIN_TOKENS` is set, so a default run of this app has no hire path. It takes `<org>:<token>` pairs, and the organization a hire lands in is the one its token names — never what the request body says:

```bash
export WORKFORCE_ADMIN_TOKENS="acme:dev-token"

curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer dev-token" \
  -d '{"userId":"you","input":{"seatId":"support.bo","flow":"desk-clerk","settings":{"desk":"back"},"instructions":"You work the back desk."}}'
```

Over HTTP rather than through `fsdev run`, because the CLI sends a fixed user and no organization, and this action needs one.

Restart the app and ask the seat something. The reload runs at startup, before the app serves anything, and reports any seat it could not bring back.

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
