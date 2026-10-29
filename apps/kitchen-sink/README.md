# Kitchen Sink

Kitchen Sink is where you use each coding harness flow-state-dev supports, directly, and see whether its integration holds. It opens on a picker of modes. **Flow State** is the framework's own flows: the assistant, and the support desk with a coordinator and four specialists (see [The support team](#the-support-team-workforce)). The coding harness modes are listed beside it: [Claude Code](#claude-code-mode), [Cursor](#cursor-mode), and Codex, which says "not built yet" until it lands.

Kitchen Sink sets up a session and keeps it in step with the harness. It doesn't plan work for a harness or move work between harnesses; that is [Shift Manager](../../packages/shift-manager/README.md).

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

The dev command uses polling for Next's route-file watcher. Workspace source edits still reload through HMR.

To serve on another port, set `PORT`:

```bash
PORT=3001 pnpm --filter @flow-state-dev/kitchen-sink dev
```

The `curl` examples in this README use `localhost:3000`. Change the port to match.

The front page is the picker. Pick **Flow State** for the assistant and the support desk, at [http://localhost:3000/flow-state](http://localhost:3000/flow-state). A mode this machine can't run is listed with the reason, and opening it does nothing.

Coding harness modes work on a git repository. With `pnpm dev`, that is the checkout the server runs from, and you set nothing. To use another checkout, or to run them on a production server, name its top level:

```bash
# apps/kitchen-sink/.env.local
KITCHEN_SINK_HARNESS_WORKSPACE=/Users/me/code/flow-state-dev
```

The path has to be the top level of an existing git checkout; anything else turns the modes off and says why. Each session gets its own worktree and branch of that repository, so it never edits your checkout or another session's work. A production server without the setting keeps the harness modes off, and so does Vercel, even with it, because Kitchen Sink has no sign-in and anyone who can reach it acts as the same user. Restart the server after changing the setting; the picker reads it once, at start.

The `pnpm fsdev` commands below run from `apps/kitchen-sink`, where `fsdev.config.ts` gives the CLI the same flows, models and stores the app has.

### Without a model key

`KITCHEN_SINK_TEST_MODE=1` swaps every model for a scripted one, so the app runs with no key at all:

```bash
KITCHEN_SINK_TEST_MODE=1 pnpm --filter @flow-state-dev/kitchen-sink dev
```

The specialists and the assistant all answer with the same placeholder, `Test mode (no scenario sentinel matched).`, but the coordinator in front of them works as it does with a key: a post to `support.help` goes to one specialist, and that specialist's answer lands in your conversation under its name. The scripted pick can't read a question, so it goes by a tag instead. A post containing `[route:support.devices]` goes to `support.devices`, and a post with no tag goes to `support.general`, the coordinator's fallback. The end-to-end tests run in this mode.

## What to read first

- `workforce/`: the support team, four specialists and the coordinator that sends each post to one of them. This is the authoring path, and the shortest route to understanding the app.
- `app/page.tsx`: the picker. `app/flow-state/page.tsx`: the Flow State shell, with one navigator on the left, the stream in the middle, and the roster on the right.
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

Workers can also be hired while the app is running, which is the other half of the demonstration. The four specialists are declared in files. A worker you hire is a row in your own roster, kept in the database, and it belongs to you. Nothing is registered and nothing restarts: its first turn runs on the flow it names, on every process. Locally it is still there after `pnpm build && pnpm start`, because the default store is a SQLite file at `.fsdev/data/flowstate.db`. Set `STORE_TYPE=memory` for a store that starts empty each time, or point `FSD_DB_URL` at a database.

Hiring goes through the roster flow, `workforce-roster`. Open a session on it, then run its `hire` action there:

```bash
curl -X POST localhost:3000/api/flows/workforce-roster/sessions \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser"}'

curl -X POST localhost:3000/api/flows/workforce-roster/actions/hire \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser","sessionId":"<the roster session id>","input":{"id":"refunds","flow":"agent","description":"Takes refund questions.","instructions":"You take refund questions."}}'
```

Talk to the new worker the way you talk to a specialist: open a session on its flow, `agent`, naming it, and post to it:

```bash
curl -X POST localhost:3000/api/flows/agent/sessions \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser","state":{"workerId":"refunds"}}'

curl -X POST localhost:3000/api/flows/agent/actions/respond \
  -H 'content-type: application/json' \
  -d '{"userId":"devuser","sessionId":"<the session id>","input":{"message":"Where is my refund?"}}'
```

The same session takes `edit`, which changes the worker's instructions or settings from its next turn on, and `fire`, which takes it off your roster. A fired worker's conversations stay readable, and a new turn in one is refused. The specialists the files declare can't be edited or fired. `fork` copies one to a worker of your own, which you can then edit.

A hired worker doesn't show in the rail and doesn't join `support.help`'s routing: a coordinator's delegates are the ones its file names. The page has no control for hiring.

## The page (`app/`)

- **Front page**: the picker. Each mode has its own address: `/flow-state`, `/claude-code`, `/codex`, `/cursor`. Every mode's rail opens with the mode's name and a link back here.
- **Layout** (Flow State): three columns. A `FlowNavigator` rail over your conversations with the coordinator, with workers, and with the assistant; the stream; and a standing panel with the roster (plus artifacts in build mode). Below `lg` the panel opens from the header, and below `sm` the rail does too. A row's buttons in the rail show when you hover or focus the row.
- **Coordinators**: Open `support.help` in the rail to read your conversation with it and post. Your post calls the coordinator flow's `run` action, the same one the [HTTP call above](#posting-to-the-coordinator-over-http) reaches, and appears as `devuser`, the one user this app runs as. Answers appear while the view is open, and the view shows which specialist is working.
- **Workers**: Open a specialist in the rail to see its kind and what it handles, under its row. The **+** on its row starts a conversation with it; your message and its reply stay in that conversation. See [Talking to one specialist](#talking-to-one-specialist).
- **Roster**: The team panel's roster lists workers [hired while the app runs](#hiring-while-the-app-runs), not the four declared in files. Until you hire one, it says no workers have been hired in this organization yet, while the rail lists the four specialists.
- **Session management**: Open the assistant in the rail and press the **+** on its row (New session) to start a session. Its sessions are listed under it; pick one to switch to it.
- **AI Elements**: Conversation, Message (with Streamdown markdown), Reasoning, Tool, Suggestion, Shimmer, PromptInput
- **Bridge components**: Map flow-state item types (`MessageItem`, `ReasoningItem`, `BlockOutputItem`, `StatusItem`, `ErrorItem`) to AI Element visuals
- **Client data bar**: Live display of mode status, request count, user preferences
- **Mode selector**: Chat / Plan / Review tabs that feed into `sendAction`
- **Tool call visualization**: Inline display of tool invocations with args + output via AI Elements Tool component
- **Streaming indicators**: PromptInputSubmit status, Shimmer for status items, skeleton cards for in-progress blocks

## Claude Code mode

Pick **Claude Code** to work a Claude Code session the way you would on its own. Each turn continues the same Claude Code conversation, its steps show while it works, and its to-do list sits beside it.

It runs on your machine, through the Claude Code Agent SDK, signed in the way Claude Code is on its own. Sign in with the `claude` command first. A host that isn't signed in, a host without the SDK, or a server running as root shows the mode as unavailable, with the reason.

**Where it works.** Claude Code works on this repository. Each session gets its own git worktree, cut from your checkout's `HEAD` on a branch named `kitchen-sink/claude-code-session/<session>`, and every turn of that session works there. Worktrees live outside the repository, under `~/.local/state/flow-state-dev/kitchen-sink-harness/` (or `$XDG_STATE_HOME` if you set it), in a folder named for the repository. Your own checkout is never touched, and two sessions never share a worktree. Your checkout's git hooks don't run when a worktree is made, so a `post-checkout` hook that builds or installs won't stop a session.

**Kitchen Sink confines no run.** Claude Code asks for no approval and runs with no sandbox, so it writes, commits and runs commands wherever the server's OS user can — this checkout included, not just the session's worktree. Kitchen Sink is a showcase meant to run on a machine where that is fine; run the server as a separate OS user, or in a container, when it is not. Nothing is merged or pushed. Worktrees and branches stay until you remove them (`git worktree remove`, then delete the branch).

The run starts with a short list of the server's environment variables: what Claude Code needs to find its tools, sign in and reach the network. That filters what it's handed, and nothing more: a command it runs as the same OS user as the server can still read the server's environment. Run the server as a separate OS user, or in a container, when that matters.

**Picking a model.** New session offers the models Claude Code lists for your sign-in, with its default preselected. The session runs the model you picked on every turn, resumes included, and keeps it after Claude Code's default moves on: its header names the model. A model Claude Code won't run fails the turn in Claude Code's words; nothing runs on another model instead. If Claude Code can't list its models, New session says why and can't start a session until a reload finds the list. To try another model, start another session. A session from before the picker runs on Claude Code's default, and its header says so.

In local development the mode uses the checkout the server runs from. To point it at another checkout, or to turn it on for a production server, set `KITCHEN_SINK_HARNESS_WORKSPACE` to that checkout's top level.

**Continuing.** A session is one Claude Code conversation. Stop a turn and the next one picks up the same conversation. If Claude Code can't continue it, the session says so on every turn and keeps trying. A turn you stopped shows as stopped, not refused. A turn Claude Code ends in error shows as an error, and the next turn still continues the same conversation. It never quietly starts a new conversation; start a new session for that. If Claude Code answers in a different conversation of its own accord, the session says it started a new one and follows it. The page's address names the open session, so a reload comes back to it.

**The plan panel** shows the to-do list Claude Code has recorded in the session's conversation, across turns, read-only. Above the rows, "Last changed in turn N" names the turn that last changed one; a turn that doesn't touch the list leaves the rows and the label as they were. Each row is a mark and the item's title beside it; a long title wraps under the mark. An open circle is to do, a spinning ring is in progress, and a check is done, with the title struck through and muted. Claude Code's to-do tool records no status when it creates an item, so a row it hasn't started reads as to do. A status the panel doesn't recognise appears next to the title in Claude Code's own word. Each mark's accessible label is its stage in words: "To do", "In progress", "Done". If part of it couldn't be recorded, the panel says the plan may be incomplete, and why. A conversation where Claude Code has kept no to-do list says "No plan recorded in this conversation." Claude Code keeps a to-do list when the job is big enough to plan, or when you ask it to. Nothing in the panel starts work.

**Older sessions.** A session whose turns each recorded their own plan shows the latest turn's rows under "Turn N", or "No plan recorded for this turn." A conversation with turns recorded that way says the plan may be incomplete.

Sessions, and the conversations they're bound to, are kept across a restart in the default SQLite store. Set `STORE_TYPE=memory` to start empty each time.

## Codex mode

Pick **Codex** to work a Codex session the way you would on its own. Each turn continues the same Codex thread, and each step shows as Codex takes it.

It runs on your machine through the Codex SDK, and needs the SDK version that `@flow-state-dev/codex` supports; any other version shows the mode as unavailable, with both versions named. Sign in with `codex login`, or put `CODEX_API_KEY` in the server's environment. A host where Codex isn't signed in shows the mode as unavailable with the reason.

**Picking a model.** New session offers the models Codex itself offers for how it is signed in, with Codex's own default preselected, so a model your account can't run isn't listed. If Codex can't list its models, New session says why and can't start a session; reload to try again. The session runs the model you picked on every turn, resumes included, and its header names it. If Codex can't run that model, the turn shows Codex's error without switching models. A session with no saved model runs Codex's own default, never the model your Codex settings name; if Codex can't list its models, that session's turn stops and says why, and the next turn tries again.

**Codex settings.** Kitchen Sink supplies the session's model and the default service tier, and disables the MCP servers it discovers in your Codex inventory. It reads that inventory on the first turn and reuses it for the server process; restart Kitchen Sink after changing your MCP servers. If the inventory can't be read, the turn warns that your configured MCP servers may start, and the next turn retries discovery. Your personal `config.toml` is unchanged.

**Where it works.** Codex works in the session's own worktree and branch, on `kitchen-sink/codex-session/<session>`, the same way Claude Code mode does (see [Claude Code mode](#claude-code-mode) for where worktrees live and how to clear them). It runs without asking for approval and with its sandbox off (`danger-full-access`), so like every harness mode here it is not confined to that worktree — see [Claude Code mode](#claude-code-mode). It sees only the environment variables Kitchen Sink passes it, not the server's whole environment. That filters what it's handed and nothing more: a command it runs as the same OS user as the server can still read the server's environment. Run the server as a separate OS user, or in a container, when that matters.

**Continuing.** A session is one Codex thread. Stop a turn and the next one continues the same thread. Codex keeps its threads in its own home directory (`~/.codex` unless you set `CODEX_HOME`), not in the session's directory. If Codex no longer has a session's thread, because its record was cleared or the server points at a different Codex home, the session says Codex refused it, on every turn. It never moves to a new thread on its own; start a new session for that. A turn Codex itself fails shows as an error, and the next turn still continues the same thread.

**Steps.** Codex reports each step whole: a command shows when it starts and again when it finishes, and a reply shows once Codex has written all of it.

**The plan panel** says "Codex reports no plan." In the version Kitchen Sink runs, Codex doesn't keep a to-do list.

## Cursor mode

Pick **Cursor** to work a Cursor session the way you would on its own. Each turn continues the same Cursor agent, its steps show while it works, and its to-do list sits beside it.

It runs on your machine through the Cursor SDK, which brings its own runtime, so the Cursor editor isn't needed. Sign in the way the SDK does: set `CURSOR_API_KEY`, or log in once with the SDK's login. A host without the SDK at the version the mode is tested against, or without a key or a login, shows the mode as unavailable, with the reason.

**Where it works.** Like every harness mode, each session gets its own git worktree and branch of the repository `KITCHEN_SINK_HARNESS_WORKSPACE` names, on `kitchen-sink/cursor-session/<session>`, and every turn of that session works there (see [Claude Code mode](#claude-code-mode) for where worktrees live and how to clear them). Cursor runs with its sandbox off, so like every harness mode here it is not confined to that worktree — see [Claude Code mode](#claude-code-mode).

Its commands start with only the environment variables Kitchen Sink passes it, not the server's whole environment: Cursor's runtime runs in a separate process that is handed only those. That is not a security boundary; the process runs as the server's OS user, so a command that goes looking can still read the server's environment on Linux. Containing that takes a separate user or a container. A command Cursor started can keep running briefly after you stop a turn.

**Picking a model.** New session offers a fixed list, kept in the app and not read from your Cursor account: Grok 4.7 at four efforts (shown "Grok 4.7 · Low", "· Medium", "· High" and "· Extra High"), Composer 2.5 (preselected), Gemini 4 Argon, Muse Wonder, Kimi K3, GLM 5.3, GLM 5.3 Flash, and "Auto (Cursor picks)". The effort is part of a Grok pick and reaches Cursor as the model's effort setting; every other model runs on Cursor's own defaults for its settings. The session runs the model you picked on every turn, resumes included, and its header names it. A model your Cursor account can't run fails the turn in Cursor's words. A session with no saved model runs on Composer 2.5.

**Continuing.** A session is one Cursor agent. Stop a turn and the next one picks up the same agent. If Cursor won't resume it, the session says so on every turn and keeps trying. A turn you stopped shows as stopped, not refused. A run Cursor reports as errored shows as an error, and the next turn still continues the same agent. It never quietly starts a new agent; start a new session for that.

**Sending a line while it works.** Type while a turn is running and the line joins that turn: Cursor takes it in and carries on, and the line shows under the turn as taken into the running turn. If Cursor turns it away, the line runs as the next turn instead, and says so. The flow's `steer` action is what does this, beside `turn`. The other harness modes queue the line as the next turn.

**The plan panel** shows the Cursor agent's to-do list, as Cursor last confirmed it in any turn of the session, read-only. Above the rows, "Last changed in turn N" names the turn that last changed it; a turn that doesn't touch the list leaves the rows and the label as they were. Each row is a mark and the item's title beside it; a long title wraps under the mark. An open circle is to do, a spinning ring is in progress, and a check is done, with the title struck through and muted. A row with no status reads as to do, and a status the panel doesn't recognise appears next to the title in Cursor's own word. Each mark's accessible label is its stage in words: "To do", "In progress", "Done". An agent that has kept no list says "No plan recorded in this conversation." One that emptied its list says "The plan is empty." If the list couldn't be saved in full, the panel says the plan may be incomplete. When Cursor reorders its list, the rows follow their places, not the items. Nothing in the panel starts work.

**Older sessions.** A session whose turns each recorded their own list shows the latest turn's list under "Turn N", or "No plan recorded for this turn." A conversation with turns recorded that way says the plan may be incomplete.

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
| `KITCHEN_SINK_HARNESS_WORKSPACE` | The top level of the git checkout the coding harness modes work on. Each session gets its own worktree and branch of it, kept outside the checkout under `~/.local/state/flow-state-dev/kitchen-sink-harness/`. Unset, they use the checkout the server runs from in local development, and are off otherwise. Ignored on Vercel, where they're always off. |
| `PORT` | The port the server listens on. Defaults to `3000`. |
| `STORE_TYPE` | The default keeps sessions and hired workers in a SQLite file, `.fsdev/data/flowstate.db`, across restarts. `memory` starts empty each time, and `filesystem` keeps JSON files in `.fsdev/data` instead. Ignored when a database URL is set. |
| `FSD_DB_URL` | A Postgres connection string. When set, the app stores everything there. `DATABASE_URL` is read if `FSD_DB_URL` isn't set. |
| `REDIS_URL` | Redis for BullMQ background jobs, local dev only. `docker compose -f docker-compose.dev.yml up -d`, run from `apps/kitchen-sink`, starts one. |
| `FSD_BULLMQ_DISPATCH` | `1` sends every action dispatch through the BullMQ queue instead of running it in process. Needs `REDIS_URL`. |

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
    page.tsx                 The picker: four modes, each with its availability
    flow-state/page.tsx      The Flow State shell: navigator rail, stream, standing panel
    layout.tsx               Root layout
    globals.css              The Flow State brand: the design system's import over tokens.css
    tokens.css               The registry's tokens item, unedited
    api/flows/               Flow API routes (SSE streaming)
  flows/
    chat-agent/              The assistant
      flow.ts                Flow definition (source of truth)
      run/                   The chat turn
      shared/                Schemas, prompts, capabilities, artifacts
      *.ts                   The other actions (approval gate, settings, ...)
    rich-text-component/     Text transformations for the artifact editor
    weekly-digest/           Scheduled actions
  workforce/                 The support team: teams/, workforce.gen.ts
  components/
    flow-state/              Shared item-renderer UI (installed from @flow-state-dev/ui)
    chat-agent/              chat-agent-specific renderers
    ui/                      shadcn/ui primitives
    ...                      Shared app UI (team panel, worker pane, mode selector, etc.)
  lib/
    flowstate.ts             Re-exports the FlowState from fsdev.config.ts for routes and the CLI
    mcp.ts                   Optional MCP capability (env-gated)
    utils.ts                 cn() utility
  skills/                    Bundled skill markdown
  test/                      Vitest test suite
  e2e/                       Playwright suite
```

Additional flows live alongside `chat-agent/` under `flows/` and mount at their own route under `app/`.
