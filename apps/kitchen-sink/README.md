# Kitchen Sink

The canonical reference application for `@flow-state-dev`, and a Workforce app you can copy. It hires a support team with a coordinator in front, and shows it in a shell whose navigator is imported from `@flow-state-dev/react` and whose roster is read through Workforce's client.

Kitchen sink is a reference app, not a minimal example. It hosts every subsystem and is where features get tested end to end. For small, focused, copy-paste-able demos see `examples/`.

## Run it

From the monorepo root:

```bash
pnpm install
cp apps/kitchen-sink/.env.local.example apps/kitchen-sink/.env.local
# Edit apps/kitchen-sink/.env.local and set AI_GATEWAY_API_KEY
pnpm --filter @flow-state-dev/kitchen-sink dev
```

The app runs at [http://localhost:3000](http://localhost:3000). Every model it uses goes through the Vercel AI Gateway, so `AI_GATEWAY_API_KEY` is required for real answers. `OPENAI_API_KEY` is optional and only enables voice. [Environment variables](#environment-variables) covers the rest.

To serve on another port, set `PORT`:

```bash
PORT=3001 pnpm --filter @flow-state-dev/kitchen-sink dev
```

The `curl` examples in this README use `localhost:3000`. Change the port to match.

The `pnpm fsdev` commands below run from `apps/kitchen-sink`, where `fsdev.config.ts` gives the CLI the same flows, models and stores the app has.

### Without a model key

`KITCHEN_SINK_TEST_MODE=1` swaps every model for a scripted one, so the app runs with no key at all:

```bash
KITCHEN_SINK_TEST_MODE=1 pnpm --filter @flow-state-dev/kitchen-sink dev
```

The specialists and the assistant all answer with the same placeholder, `Test mode (no scenario sentinel matched).`, but the coordinator in front of them works as it does with a key: a post to `support.help` goes to one specialist, and that specialist's answer lands in your conversation under its name. The scripted pick can't read a question, so it goes by a tag instead. A post containing `[route:support.devices]` goes to `support.devices`, and a post with no tag goes to `support.general`, the coordinator's fallback. The end-to-end tests run in this mode.

## What to read first

- `workforce/`: the support team, four specialists and the coordinator that sends each post to one of them. This is the authoring path, and the shortest route to understanding the app.
- `app/page.tsx`: the shell, with one navigator on the left, the stream in the middle, and the roster on the right.
- `flows/`: the flows the app serves, including `chat-agent`, the assistant the stream talks to.

The chat agent either answers in the turn or files the work to a durable board, where a child session picks it up and the result comes back on a later turn. For coordination that happens inside a single request, see the [patterns documentation](../docs/docs/patterns/overview.md); each pattern page carries its own runnable example. The app uses one pattern, the response auditor, which annotates an answer after it's produced.

## The support team (`workforce/`)

The support team is one coordinator and four specialists, declared in files rather than wired in code.

Open `support.help` in the rail (under Coordinators) and ask a question. The coordinator sends each post to the one specialist whose job fits it: `support.devices` for printers, laptops, phones and wifi, `support.accounts` for sign-in and billing, `support.fsd` for questions about building with flow-state-dev, and `support.general` for anything else. You see which specialist is working on it, then its answer as a line under its name, without reloading.

The rail shows your own conversation with `support.help`. Every user has one, and nobody else reads it.

Each specialist is a `WORKER.md` under `workforce/teams/support/workers/`. Its `description:` is its job, and it is what the coordinator reads to decide who answers:

```md
---
description: Printers, laptops, phones, wifi and anything else with a power button.
---

You are the support team's devices specialist. Answer in a sentence or two, and say plainly
when you don't know.
```

None of the four names a `flow:`, so all of them run on the built-in agent flow.

### How a post finds its specialist

The coordinator is a worker too, in `workforce/teams/support/workers/help/WORKER.md`:

```md
---
description: Ask the support team anything.
flow: coordinator
delegates: [support.devices, support.accounts, support.fsd, support.general]
routing: best-fit
fallback: support.general
---
```

`flow: coordinator` puts it on Workforce's coordinator flow, which `workforce/hire.ts` registers with `defineCoordinatorFlow`, naming the built-in agent flow as the one its delegates answer on and `ROUTE_MODEL` as the model it picks with. For each post from a person, if their last post is still waiting on a specialist, this one goes there too. Otherwise one evaluator call picks a specialist from the four descriptions, reading the post. (An evaluator is a block that answers a typed question with one model call.) If that call fails, `support.general` takes the post. Only the chosen specialist hears it.

`ROUTE_MODEL` lives in `lib/models.ts`. It has to be a model that can evaluate, and not every chat model can: see [Evaluation models](../docs/docs/fundamentals/models.md#evaluation-models). The specialists answer on the [`chat` intent](../docs/docs/fundamentals/models.md#intents) under `models.intents` in `fsdev.config.ts`, because no `WORKER.md` names a `model:` of its own.

The pick reads the post on its own, not the conversation around it. A follow-up such as "it fails right after the password", sent after the specialist has answered, is placed on its own words, so it can reach a different specialist than the one that answered the post it follows. Each specialist keeps its own session for your conversation with `support.help`, holding only the posts it was handed and its answers, so it doesn't see what another specialist said.

Swap `routing: best-fit` for `routing: everyone` and every specialist hears every post and answers it.

The support desk needs actions to run in process. With `FSD_BULLMQ_DISPATCH=1` (see [Environment variables](#environment-variables)), a post to `support.help` shows up in the conversation but no specialist answers it.

### Talking to one specialist

To talk to a specialist directly, press **Talk** on its row in the roster on the right. That conversation is separate from your conversation with `support.help` and keeps both sides across a reload. The specialist sees the earlier turns of that conversation and nothing from any other.

```bash
pnpm fsdev run support.devices run -i '{"message":"My phone stopped charging."}'
```

The rail lists your conversations with specialists under Workers, and with them each specialist's session for your conversation with `support.help`. That row is labelled with its session id, a long string starting `dsx_`.

### Posting to the coordinator over HTTP

A conversation with `support.help` is a session on the `coordinator` flow that names it. Open one, then post to it through the flow's `run` action:

```bash
curl -X POST localhost:3000/api/flows/coordinator/sessions \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser","state":{"workerId":"support.help"}}'

curl -X POST localhost:3000/api/flows/coordinator/actions/run \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser","sessionId":"<the session id>","input":{"message":"My phone stopped charging."}}'
```

The post is kept as your turn, and the specialist's answer lands on the same session a moment later. Whatever `userId` you send, this app runs the call as `devuser` (see [One organization](#one-organization)).

To read the lines back, read the session's messages:

```bash
curl 'localhost:3000/api/flows/sessions/<the session id>/state?include_items=true&item_types=message'
```

Your posts are the `user` messages. Each specialist's answer is a message whose `agentName` is the specialist's id. The `coordinator-route` component items beside them record which specialist each post went to.

### Where the pieces come from

Tools, blocks and capabilities come from files too: a file under `workforce/blocks/` or a `resources/` folder becomes an entry in `workforce/workforce.gen.ts` when you run `fsdev gen`. That module is committed, so the code an app can run is fixed when you run the command, which is what lets a bundler see it. The roster is read at boot: `buildKitchenSinkWorkforce()` walks `workforce/teams/` and reads a worker per `WORKER.md`. Adding a specialist means a folder, a line in the coordinator's `delegates:`, and a restart. Adding a tool means a file and `fsdev gen`.

A conversation copies the coordinator's `delegates:` the first time it routes a post, and keeps its own list after that, so a specialist added to the file later reaches new conversations, not ones already under way.

A specialist's answer does not wake the other specialists.

### One organization

This app runs as one organization, `kitchen-sink`, and one user, `devuser`. Both are set in `fsdev.config.ts` by a `resolvePrincipal` that reads nothing from the request. It applies to every flow that doesn't bring its own resolver, which means every page and every worker, the coordinator included, so nobody calling the app can pick another organization. It is a stand-in for real sign-in, and it means **anyone who can open a deployed copy of this app can post to its coordinator and talk to its specialists, on your model key**. If you deploy it somewhere other people can reach, put sign-in in front of it first.

### Hiring while the app runs

Seats can also be hired while the app is running, which is the other half of the demonstration. The four specialists are declared in files. A seat hired over `workforce-admin`'s `hire` action is written to the database instead, addressed with its organization and the admin user (`kitchen-sink.~workforce-admin.support.new-hire`). On a persistent store it is still there after `pnpm build && pnpm start`: set `STORE_TYPE=filesystem`, or point `FSD_DB_URL` at a database. The default store is in memory and starts empty.

The admin flow is **not registered at all** unless `WORKFORCE_ADMIN_TOKENS` is set. The variable takes `<org>:<token>` pairs, and the organization a hire lands in is the one its token names, never what the request body says:

```bash
export WORKFORCE_ADMIN_TOKENS="kitchen-sink:dev-token"

curl -X POST localhost:3000/api/flows/workforce-admin/actions/hire \
  -H 'content-type: application/json' \
  -H "authorization: Bearer dev-token" \
  -d '{"userId":"you","input":{"seatId":"support.new-hire","flow":"agent","instructions":"You take refund questions."}}'
```

The admin hire goes over HTTP because the admin flow checks a token and the CLI carries none.

The admin action has a credential of its own, but not an organization of its own. Every token has to name `kitchen-sink`. An entry naming any other organization is refused when the app starts, and the refusal is logged, so a token can never quietly administer an organization this app doesn't serve. A seat the admin action hires belongs to the operator who hired it.

The admin flow also has a `fire` action, which removes a seat the admin action hired. A hired seat doesn't show in the rail and doesn't join `support.help`: a coordinator's delegates are the ones its file names. The page has no control for hiring.

The seat answers any configured admin token, not only the one that hired it: every token resolves to the same admin principal, and the seat is pinned to that principal. It belongs to the organization and to the admin user, so its address carries both. The seat carries the admin flow's resolver, so a request with no token, or a token it doesn't recognize, gets `401` from that resolver before the pin is checked. Call it with any configured token:

```bash
curl -X POST localhost:3000/api/flows/kitchen-sink.~workforce-admin.support.new-hire/actions/run \
  -H 'content-type: application/json' \
  -H "authorization: Bearer dev-token" \
  -d '{"userId":"you","input":{"message":"Where is my order?"}}'
```

Restart the app and ask the seat something. The reload runs at startup, before the app serves anything, and reports any seat it could not bring back.

## The page (`app/`)

- **Layout**: three columns. A `FlowNavigator` rail over your conversations with the coordinator, with workers, and with the assistant; the stream; and a standing panel with the roster (plus artifacts in build mode). Below `lg` the panel opens from the header, and below `sm` the rail does too. A row's buttons in the rail show when you hover or focus the row.
- **Coordinators**: Open `support.help` in the rail to read your conversation with it and post. Your post calls the coordinator flow's `run` action, the same one the [HTTP call above](#posting-to-the-coordinator-over-http) reaches, and appears as `devuser`, the one user this app runs as. Answers appear while the view is open, and the view shows which specialist is working.
- **Seats**: Open a specialist in the rail to see its kind and what it handles, under its row. The **+** on its row starts a conversation with it; your message and its reply stay in that conversation. See [Talking to one specialist](#talking-to-one-specialist).
- **Roster**: The team panel's roster lists seats [hired while the app runs](#hiring-while-the-app-runs), not the four declared in files. Until you hire one, it says no seats have been hired in this organization yet, while the rail lists the four specialists.
- **Session management**: Open the assistant in the rail and press the **+** on its row (New session) to start a session. Its sessions are listed under it; pick one to switch to it.
- **AI Elements**: Conversation, Message (with Streamdown markdown), Reasoning, Tool, Suggestion, Shimmer, PromptInput
- **Bridge components**: Map flow-state item types (`MessageItem`, `ReasoningItem`, `BlockOutputItem`, `StatusItem`, `ErrorItem`) to AI Element visuals
- **Client data bar**: Live display of mode status, request count, user preferences
- **Mode selector**: Chat / Plan / Review tabs that feed into `sendAction`
- **Tool call visualization**: Inline display of tool invocations with args + output via AI Elements Tool component
- **Streaming indicators**: PromptInputSubmit status, Shimmer for status items, skeleton cards for in-progress blocks

## Flows

### `chat-agent` (`flows/chat-agent/`)

A multi-modal AI assistant — the flagship flow. Showcases:

- `defineFlow` with `session` and `user` scope state
- Block kinds: `handler`, `generator`, `router`, `sequencer`
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

```bash
pnpm fsdev run chat-agent run -i '{"message":"hi","mode":"ask"}'
```

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

## Environment variables

Most are optional. These are the ones you're likely to set:

| Variable | Effect |
|--|--|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key. Required for real answers: every model the app uses goes through the gateway. |
| `OPENAI_API_KEY` | Optional. Enables voice. |
| `KITCHEN_SINK_TEST_MODE` | `1` runs every model as a script and needs no key. See [Without a model key](#without-a-model-key). |
| `PORT` | The port the server listens on. Defaults to `3000`. |
| `STORE_TYPE` | `filesystem` keeps sessions and hired seats in `.fsdev/data` across restarts. The default, `memory`, starts empty each time. Ignored when a database URL is set. |
| `FSD_DB_URL` | A Postgres connection string. When set, the app stores everything there. `DATABASE_URL` is read if `FSD_DB_URL` isn't set. |
| `REDIS_URL` | Redis for BullMQ background jobs, local dev only. `docker compose -f docker-compose.dev.yml up -d`, run from `apps/kitchen-sink`, starts one. |
| `FSD_BULLMQ_DISPATCH` | `1` sends every action dispatch through the BullMQ queue instead of running it in process. Needs `REDIS_URL`. |
| `WORKFORCE_ADMIN_TOKENS` | `<org>:<token>` pairs. Registers the `workforce-admin` flow. See [Hiring while the app runs](#hiring-while-the-app-runs). |

### Bash tool provider

These change behavior on a deployed environment.

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

## Tests

`test/` is the Vitest suite:

- `testFlow` and `testBlock` for flow-level and block-level tests
- `testRouter` for router decision testing
- Seeded state and resources
- Item type and content assertions

`e2e/` is the Playwright suite. It serves a production build on the scripted model (`KITCHEN_SINK_TEST_MODE=1`), with no model key.

```bash
# Run tests
pnpm --filter @flow-state-dev/kitchen-sink test

# Production build (includes TypeScript type checking)
pnpm --filter @flow-state-dev/kitchen-sink build
```

## Architecture

```
apps/kitchen-sink/
  fsdev.config.ts            The FlowState: flows, stores, principal resolver (source of truth)
  app/                       Next.js App Router
    page.tsx                 The shell: navigator rail, stream, standing panel
    layout.tsx               Root layout with Inter font
    api/flows/               Flow API routes (SSE streaming)
  flows/
    chat-agent/              The assistant
      flow.ts                Flow definition (source of truth)
      run/                   The chat turn
      shared/                Schemas, prompts, capabilities, artifacts
      *.ts                   The other actions (approval gate, settings, ...)
    rich-text-component/     Text transformations for the artifact editor
    weekly-digest/           Scheduled actions
    workforce-admin/         The operator's hire and fire actions
  workforce/                 The support team: teams/, workforce.gen.ts
  components/
    flow-state/              Shared item-renderer UI (installed from @flow-state-dev/ui)
    chat-agent/              chat-agent-specific renderers
    ui/                      shadcn/ui primitives
    ...                      Shared app UI (team panel, seat pane, mode selector, etc.)
  lib/
    flowstate.ts             Re-exports the FlowState from fsdev.config.ts for routes and the CLI
    mcp.ts                   Optional MCP capability (env-gated)
    utils.ts                 cn() utility
  skills/                    Bundled skill markdown
  test/                      Vitest test suite
  e2e/                       Playwright suite
```

Additional flows live alongside `chat-agent/` under `flows/` and mount at their own route under `app/`.
