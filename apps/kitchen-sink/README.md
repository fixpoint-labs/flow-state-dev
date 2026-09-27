# Kitchen Sink

The canonical reference application for `@flow-state-dev`, and a Workforce app you can copy. It hires a team, gives that team a channel and a board, and shows all of it in a shell whose navigator, roster and board columns are imported from `@flow-state-dev/react`.

Kitchen sink is a reference app, not a minimal example. It hosts every subsystem and is where features get tested end to end. For small, focused, copy-paste-able demos see `examples/`.

## What to read first

- `workforce/` — the support team: four specialists and the channel that sends each post to one of them. This is the authoring path, and the shortest route to understanding the app.
- `app/page.tsx` — the shell: one navigator on the left, the stream in the middle, boards and the roster on the right.
- `flows/` — the flows the app serves, including `chat-agent`, the assistant the stream talks to.

The chat agent either answers in the turn or files the work to a durable board, where a child session picks it up and the result comes back on a later turn. For coordination that happens inside a single request, see the [patterns documentation](../docs/docs/patterns/overview.md); each pattern page carries its own runnable example. The app uses one pattern, the response auditor, which annotates an answer after it's produced.

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

The support team is one channel and four specialists, declared in files rather than wired in code.

Open `support.help` in the rail and ask a question. The channel sends each post to the one specialist whose job fits it: `support.devices` for printers, laptops, phones and wifi, `support.accounts` for sign-in and billing, `support.fsd` for questions about building with flow-state-dev, and `support.general` for anything else. The specialist answers in the channel, under its own name, and its answer shows up the next time the channel is read.

The rail lists the channels the files declare. A store kept from an earlier version of the app can still hold other channels' sessions; they stay in the store and don't show in the rail.

Each specialist is a `WORKER.md` under `workforce/teams/support/workers/`. Its `description:` is its job, and it is what the channel reads to decide who answers:

```md
---
description: Printers, laptops, phones, wifi and anything else with a power button.
tools: [post-to-channel, escalate]
---

You are the support team's devices specialist. Answer in a sentence or two, and say plainly
when you don't know. When a case needs a person, file it with `escalate` and say you did.
```

None of the four names a `flow:`, so all of them run on the built-in agent kind.

#### How a post finds its specialist

Routing is two lines in `workforce/teams/support/channels/help/CHANNEL.md`:

```md
routing:
  fallback: support.general
```

and one in `workforce/hire.ts`, where the channel kind is built with `routeByPurpose(seats, { model: ROUTE_MODEL })`. For each post from a person, if their last post is still waiting on a specialist, this one goes there too. Otherwise one evaluator call picks a specialist from the four descriptions, reading the channel's recent lines along with the post. (An evaluator is a block that answers a typed question with one model call.) If that call fails, `support.general` takes the post. Only the chosen specialist hears it.

`ROUTE_MODEL` lives in `lib/models.ts`. It has to be a model that can evaluate, and not every chat model can: see [Evaluation models](../docs/docs/fundamentals/models.md#evaluation-models).

The specialist answers with the channel's last 20 lines in view, so "where can I buy it?" finds its "it" even when the laptop came up with a different specialist. Its own conversation for the channel keeps only the posts routed to it and its answers, so something said further back, to someone else, may need saying again.

Take the `routing:` lines out and every specialist hears every post, which is what a channel does by default.

#### When a case needs a person

A specialist that decides a case needs a person calls `escalate`, a tool in `workforce/blocks/escalate.ts`. It files one row onto the channel's `escalations` board through the channel's own `fileTask` action, signed with the specialist's own id, and the specialist says so in its answer. The model chooses only what the row says. The rows show in the team panel's `escalations` column.

Only the channel's members can file there. Any other seat given the tool is told nothing was filed, and nothing is sent to the channel.

Nobody works `escalations` in this app, and the boot says so:

```
[workforce] channel "support.help" holds board "escalations" (ledger
"support.help.escalations"), and no flow hired in this call declares it. …
```

Rows piling up with nothing said is the one failure a declared board can produce in silence, so the reference ships in the state that shows you the message.

Filing needs the in-process dispatcher. Run the app with `FSD_BULLMQ_DISPATCH=1` and a specialist still answers, but says it couldn't file.

#### Talking to one specialist

Open a specialist in the rail and start a new conversation to talk to it directly. That conversation is separate from the channel and keeps both sides across a reload. The specialist sees the earlier turns of that conversation and nothing from any other.

```bash
pnpm fsdev run support.devices run -i '{"message":"My phone stopped charging."}'
```

#### Where the pieces come from

Tools, blocks and capabilities come from files too: a file under `workforce/blocks/` or a `resources/` folder becomes an entry in `workforce/workforce.gen.ts` when you run `fsdev gen`. That module is committed, so the code an app can run is fixed when you run the command, which is what lets a bundler see it. The roster is read at boot: `hireKitchenSinkWorkforce()` walks `workforce/teams/` and hires a seat per `WORKER.md`. Adding a specialist means a folder, a line in the channel's `members:`, and a restart. Adding a tool means a file and `fsdev gen`.

Channels are opened at boot, and opening is idempotent. Re-opening is not a migration: an open channel keeps the members and charter it was opened with, so on a persistent store a new specialist doesn't join a channel that is already open. `boards:` and `routing:` are the exceptions, read from the file on every boot.

A seat's post wakes nobody, so a specialist's answer never sets off another. The check is on the claimed `author`, which the channel does not verify; an app with a real identity model should compare whatever it resolves a caller to.

Which organization the channel sessions land in comes from the caller's verified identity, not from anything a file declares. If you add authentication, open them as a caller whose identity already carries the organization you want: [which organization a channel runs in](../docs/docs/workforce/channels.md#which-organization-a-channel-runs-in).

#### One organization

This app runs as one organization, `kitchen-sink`, and one user, `devuser`. Both are set in `fsdev.config.ts` by a `resolvePrincipal` that reads nothing from the request. It applies to every flow that doesn't bring its own resolver, which means every page, seat and channel, so nobody calling the app can pick another organization. It is a stand-in for real sign-in, and it means **anyone who can open a deployed copy of this app can post to its channel and talk to its seats, on your model key**. If you deploy it somewhere other people can reach, put sign-in in front of it first.

**If the app refuses to start with `[workforce] this store was written before kitchen-sink ran as organization "kitchen-sink"`**, the store holds channel sessions from another organization, and the message names each one with the organization it belongs to. That data can't be carried over, so delete the store and restart. For the local filesystem profile, delete `.fsdev/data` (or the whole `.fsdev` folder). For Postgres, point `FSD_DB_URL` at an empty database.

#### Hiring while the app runs

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

The admin flow also has a `fire` action, which removes a seat the admin action hired. A hired seat doesn't show in the rail and doesn't join `support.help`: a channel's members are the ones its file names. Hiring from the page comes back once a hired specialist can join the channel.

The seat answers any configured admin token, not only the one that hired it: every token resolves to the same admin principal, and the seat is pinned to that principal. It belongs to the organization and to the admin user, so its address carries both. The seat carries the admin flow's resolver, so a request with no token, or a token it doesn't recognize, gets `401` from that resolver before the pin is checked. Call it with any configured token:

```bash
curl -X POST localhost:3000/api/flows/kitchen-sink.~workforce-admin.support.new-hire/actions/run \
  -H 'content-type: application/json' \
  -H "authorization: Bearer dev-token" \
  -d '{"userId":"you","input":{"message":"Where is my order?"}}'
```

Restart the app and ask the seat something. The reload runs at startup, before the app serves anything, and reports any seat it could not bring back.

## Web Application (`app/`)

- Three-column layout: a `FlowNavigator` rail over channels, seats and the assistant's conversations; the stream; and a standing panel with the roster and the channel boards (plus artifacts in build mode). Below `lg` the panel opens from the header, and below `sm` the rail does too
- **Seats**: Open a seat in the rail to see its kind, under its row
- **AI Elements**: Conversation, Message (with Streamdown markdown), Reasoning, Tool, Suggestion, Shimmer, PromptInput
- **Bridge components**: Map flow-state item types (`MessageItem`, `ReasoningItem`, `BlockOutputItem`, `StatusItem`, `ErrorItem`) to AI Element visuals
- **Client data bar**: Live display of mode status, request count, user preferences
- **Mode selector**: Chat / Plan / Review tabs that feed into `sendAction`
- **Session management**: Create and switch between the assistant's sessions from its row in the rail. A seat's row has **New conversation** too
- **Channels**: Open `support.help` in the rail to read it and post. Your post calls the channel's own `post` action, the same one `fsdev run` calls, and appears as `devuser`, the one user this app runs as. Lines a specialist posts show up the next time the channel is read
- **Seats**: Open a specialist's conversation to talk to it directly. Your message and its reply stay in that conversation
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

2. Copy the environment template and add your Vercel AI Gateway API key:

```bash
cp apps/kitchen-sink/.env.local.example apps/kitchen-sink/.env.local
# Edit .env.local and set AI_GATEWAY_API_KEY
```

Every model the app uses goes through the Vercel AI Gateway, so `AI_GATEWAY_API_KEY` is required. `OPENAI_API_KEY` is optional and only enables voice.

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
  fsdev.config.ts            The FlowState: flows, stores, principal resolver (source of truth)
  app/                       Next.js App Router
    page.tsx                 The shell: navigator rail, stream, standing panel
    layout.tsx               Root layout with Inter font
    api/flows/               Flow API routes (SSE streaming)
  flows/
    chat-agent/              Flow-specific code
      index.ts               Barrel: chatAgentFlow + blocks
      flow.ts                Flow definition (source of truth)
      schemas.ts             Shared Zod schemas
      prompts.ts             Mode prompts
      blocks/                Individual block definitions
    workforce-admin/         The operator's hire and fire actions
  workforce/                 The support team: teams/, the escalate tool under blocks/, workforce.gen.ts
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
```

Additional flows live alongside `chat-agent/` under `flows/` and mount at their own route under `app/`.
