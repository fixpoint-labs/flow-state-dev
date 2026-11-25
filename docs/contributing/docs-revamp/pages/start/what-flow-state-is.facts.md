# Fact sheet: What Flow State is (S-1, `start/what-flow-state-is`)

Pass 1. Every fact the page will state, with file and line. Cites only: existing user docs (root
`README.md`, `apps/docs/`, package READMEs), the exported surface and its doc comments, tests and
`goals/`, and one example (`labs/teammates`, `examples/hello-chat`). No `specs/`. Every surface
here is built, so there is no "reconcile at cutover" mark.

Paths are from the repository root. "Draft" is
`docs/contributing/docs-revamp/pages/start/what-flow-state-is.md`.

## Corrections the draft needs

These are places where the draft's code or claim disagrees with the code. The code wins.

| # | Draft says | Code says | Source |
| --- | --- | --- | --- |
| C1 | `import { workforce } from "@flow-state-dev/workforce"` (draft line 49) | `workforce` is exported from the `./kit` subpath only. The root does not export it. Import `@flow-state-dev/workforce/kit`. | `packages/workforce/src/index.ts:1-16` (doc comment: "`workforce({ directory })` from the `./kit` subpath"); `packages/workforce/src/kit/index.ts:8-16`; `packages/workforce/package.json:45` |
| C2 | `harnesses({ workspace: { root: "./runs", sourceRepo: ".", baseRef: "main" } })` (draft line 54) | `workspace` is a `WorkspaceHost`, a value built by `localWorkspaceHost({ root, remotes, source, localRepositories, … })`. For one repository on this machine, `localRepoWorkspaceHost({ root, repo, baseRef })` builds it; there is no plain-object form. | `packages/harness-manager/src/kit/coder-flow.ts:72-74`; `packages/harness-manager/src/kit/harnesses-kit.ts:46-50`; `packages/workspace/src/local-host.ts:194-201,656`; `packages/harness-manager/src/workspace.ts:78-87,818-828`; Teammates builds it at `labs/teammates/host.mts:320-326` |
| C3 | Config file is `fsdev.config.ts` containing the three-kit list | `fsdev.config.ts` is a valid name (first in the list the CLI searches). Teammates' own is `fsdev.config.mts` plus a `host.mts` that builds `createFlowState`; the three-kit list is a simplification of `host.mts:363-399`. Say so in the example's lead-in, or build the example from a real host. | `packages/fsdev/src/load-config.ts:23-26`; `labs/teammates/fsdev.config.mts:50-66`; `labs/teammates/host.mts:362-399` |
| C4 | Starter's researcher `tools: [search, fetch]` works as written | A worker that names a tool nothing registers is refused at start. `search` and `fetch` exist in Teammates because its host puts them in the agent flow's `catalog`. A starter's file works because its flow carries those tools. | `packages/workforce/src/agent-worker-flow.ts:485-505`; `labs/teammates/host.mts:371-375` (the `catalog` entry holding `search` and `fetch`, in the `workforce({ agent })` block) |
| C5 | The draft's WORKER.md has `name: researcher`, `description`, `tools`. | Fine. The real file has more keys (`icon`, `color`, more tools) and a longer body; the draft's is a cut-down copy. `description` is the only required key. | `labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md:1-17`; `README.md:82`; `apps/docs/docs/workforce/workers-on-disk.md` ("`description` is the only key the file itself requires") |
| C6 | (Not in the draft; flagged for the Reference/other pages.) `apps/docs/docs/workforce/durable-hire.md` says editing a standard worker is refused. | The code makes the user's own copy under the same id; the file is never written. The test is the evidence. | `packages/workforce/test/worker-roster.test.ts:1-6,259-296`; contradicts `apps/docs/docs/workforce/durable-hire.md` (the refusals table row "An edit of a standard worker"). This page does not need the claim. Fix the other page. |

## Opening: what the thing is

| Claim the page makes | Fact | Source |
| --- | --- | --- |
| Run a starter and you get a team of AI workers and a page to talk to them on | A starter is "a complete app: React pages, a team of workers, and the flows they run on." | `README.md:21` |
| The workers are agents you brief in plain files | Each worker is a `WORKER.md`: frontmatter says who it is and what it can use, the body is its instructions. | `README.md:65` |
| Behind both is a backend that streams answers | A flow's run streams typed items over SSE; a client can disconnect and resume from a sequence-number cursor. | `apps/docs/docs/intro.md:8,71-81`; `README.md:6` ("output streamed to the browser as it is written") |
| ...keeps what they learned | Teammates records memory with the `system({ working, episodic, semantic })` memory capability, and the README lists "State and memory kept in your own stores". | `labs/teammates/host.mts:305,376`; `README.md:6` |
| ...and picks a run back up where it stopped after a crash | Durable execution is on by default when the resolved stores persist (filesystem, SQLite, Postgres): sequencers checkpoint and a crashed request resumes. It is off by default over in-memory stores. The starters use SQLite. | `packages/engine/src/flowstate/types.ts:319-333` (the `durable` option's doc comment); `README.md:59,111`; `labs/teammates/host.mts:400,403` (`sqliteStores`, `durable: true`) |
| Evidence the resume is not a restart | A continued interrupted request replays completed work from the durable log instead of rerunning it, under the same request id. | `goals/continue-interrupted-run/continues-not-restarts/goal.md:4-6` |
| **Limit:** the resume claim holds only on a store that persists | Over in-memory stores durable execution is off unless forced. | `packages/engine/src/flowstate/types.ts:319-333` |
| The code is in your repo. The data is in your database | Starters keep their data in a SQLite file under `.fsdev/`, so conversations and tasks survive a restart. Teammates' default is `.fsdev/teammates.sqlite` in the lab's folder (`TEAMMATES_STORE` overrides). The framework is code in the repo; "You own the code ... keep the data in systems you run." | `README.md:11,59`; `labs/teammates/README.md:211`; `labs/teammates/host.mts:47,400` |
| Start with where to put an in-app user's workers | A worker a user hires or forks while the app runs is a row in that user's data, not a file. | `apps/docs/docs/workforce/durable-hire.md` ("What is stored": "one row in their user scope at `workforce/workers/<id>`") |

## "A starter is a whole app"

| Claim | Fact | Source |
| --- | --- | --- |
| A starter comes with React pages, a team of workers, and the flows they run on | Same sentence as above. | `README.md:21` |
| Two starters exist: Teammates and Claude Code-style | Both are in `labs/`. A third, Shift Manager, is in progress with placeholder screens. | `README.md:23-26`; `labs/teammates/package.json:2-4`; `labs/claude-code-style/package.json:2-4` |
| The Teammates starter is a small team you talk to one at a time | "A small team you talk to one at a time. Lead, researcher and writer each keep one long conversation, message each other where you can see it, and hand code changes to a coding agent (Claude Code, Codex or Cursor) that runs in the background." | `README.md:23`; `labs/teammates/README.md:12-31` |
| Its workers message each other where you can see it | Same. A message line in the conversation opens the other worker's session, live, in a popup. | `README.md:23`; `labs/teammates/README.md:45-49` |
| Hands code changes to a coding agent | Coding workers (`claude-code`, `codex`, `cursor`) exist as WORKER.md folders; a coding task runs in the background in a copy (git worktree) of the working folder. | `labs/teammates/workforce/teams/teammates/workers/` (folders `claude-code`, `codex`, `cursor`, `chief-of-staff`, `researcher`, `writer`); `labs/teammates/workforce/teams/teammates/TEAM.md:27-29`; `README.md:59` |
| Worker path | `workforce/teams/<team>/workers/<name>/WORKER.md` | `README.md:65`; `labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md`; `apps/docs/docs/workforce/workers-on-disk.md` ("The tree") |
| The file's shape | Frontmatter between `---` fences, instructions below. `description` is the only required key. `name` is the display name, `tools` the tools it may call, `flow` picks the flow it runs on. A starter's flow can accept more settings (Teammates reads `icon`, `color`; coding workers name `harness:`). | `README.md:82`; `apps/docs/docs/workforce/workers-on-disk.md` ("What a WORKER.md says") |
| Rewrite the brief, restart the app, and the worker follows the new one | "Edit the body and its instructions change on the next start." The workforce kit reads the `workforce/` folder at start-up. | `README.md:82`; `packages/workforce/src/kit/workforce-kit.ts:1-9,168-181` |
| Add a folder with a second file and the team has a new worker | "Add a folder and you've added a worker." A folder with `WORKER.md` under `teams/<team>/workers/` is served as a worker. | `README.md:82`; `packages/workforce/test/workforce-kit.test.ts:75-80,114-121` |
| **Limit:** a stray file stops the app | Every file in the kit's folder is used or the app refuses to start, naming each. A `WORKER.md` that does not parse also stops the start, naming the worker. | `packages/core/src/kit/define-kit.ts:68-75`; `packages/workforce/test/workforce-kit.test.ts:82-112` |
| **Limit:** starters run from a clone, not npm | "They are workspace packages that depend on the framework's source, not something you install from npm." To build on one, fork the repository and work in `labs/<starter>`. | `README.md:28` |
| The team brief | A `TEAM.md` at the top of a team's folder holds what every worker on the team is told. | `README.md:84`; `labs/teammates/workforce/teams/teammates/TEAM.md:1-29` |

### Stored parts: who owns, who sees, where, how many

The page's own subject stores things. Four questions for each.

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| A worker file (`WORKER.md`) | The app's author. It is a file in the repo, a **standard worker**. The file is never written by the app while it runs. | Every user of the app has the worker. The page's reader sees it in the repo. | On disk under `workforce/teams/<team>/workers/<name>/`, read at start-up. Not stored in the database. | One per folder. |
| A user's edit of a standard worker, or a worker they hire or fork | The user. | Only that user, in the organization they are signed in to. Another user "gets the same answer as asking for one that doesn't exist". | One row in the user's scope at `workforce/workers/<id>`, in the app's store. | One row per worker per user per organization (a user in two organizations has a separate roster in each). An edit of a standard worker is the user's copy under the same id; the file in the repo never changes. |
| `TEAM.md` | The app's author. | Every worker on that team receives its body as instructions. | On disk, top of the team's folder, read at start-up. | At most one per team; optional. |
| The kit's folder (`workforce/`) | The kit reads it; the app owns the files. | Anyone with the repo. | On disk. `directory` in the kit's config overrides the default path `workforce/`. | One folder per kit that owns one. |
| Conversations, tasks, state, memory | The user who started them (a session names its user and org). | That user; a session is bound to one organization. | The app's store. In the starters, a SQLite file under `.fsdev/`. | One session per conversation, one per task, and a lasting session for a workstream. (Teammates: one long conversation per teammate.) |
| Each coding task's working copy | The run that started it. | The machine's owner. The user's checked-out branch and files are not touched. | A git worktree on a branch of its own, under the runs folder (Teammates default `.fsdev/teammates-runs/`). | One per task. |

Sources: `apps/docs/docs/workforce/durable-hire.md` ("Who can reach a worker", "What is stored");
`packages/workforce/test/worker-roster.test.ts:1-6,259-296`; `apps/docs/docs/workforce/overview.md:18,38-42`;
`README.md:59`; `labs/teammates/README.md:12-24,211-214`; `packages/core/src/kit/define-kit.ts:139-147`.

## "A kit is a feature you install"

| Claim | Fact | Source |
| --- | --- | --- |
| A kit is a feature an app installs | "`defineKit`: the installable unit above a flow. A kit packages a feature so an app installs it with one config object." | `packages/core/src/kit/define-kit.ts:1-5` |
| An app lists its kits in `createFlowState({ kits })` | `kits` takes each kit's factory called with its config, "in any order". `createFlowState` is exported from `@flow-state-dev/engine`. | `packages/engine/src/flowstate/types.ts:124-137`; `packages/engine/src/index.ts:25`; `examples/hello-chat/fsdev.config.ts:15-21` (same call with `flows`) |
| Installing is adding a line | The factory is called with the kit's config (`workforce({ directory })`, `claudeCode()`); a kit with no required config takes none. | `packages/core/src/kit/define-kit.ts:154-198,203-210`; `packages/claude-code/src/sdk/kit.ts:66-80` (`claudeCode()` takes `{ plan? }`) |
| The listed order does not matter | Kits install in `requires` order, ties in listed order; an unsatisfiable order, a duplicate kit and a missing required kit are refused at construction. | `packages/engine/src/flowstate/kits.ts:1-20,56-70`; `goals/kits/install-in-any-order/goal.md:4,11-12` |
| The three kits in the example | `workforce` (the team and its worker flows), `harnesses` (coding harnesses; "requires workforce"), `claudeCode` (Claude Code as a harness; "requires the harness kit"). | `packages/workforce/src/kit/workforce-kit.ts:1-27,168-181`; `packages/harness-manager/src/kit/harnesses-kit.ts:1-21,87-100`; `packages/claude-code/src/sdk/kit.ts:1-21,66-75` |
| Where each import comes from | `claudeCode` from `@flow-state-dev/claude-code` (root); `createFlowState` from `@flow-state-dev/engine`; `harnesses` from `@flow-state-dev/harness-manager/kit`; `workforce` from `@flow-state-dev/workforce/kit` (see C1). | `packages/claude-code/src/sdk/index.ts:80`; `packages/engine/src/index.ts:25`; `packages/harness-manager/package.json:42`; `packages/workforce/package.json:45` |
| "The task board its workers share" comes from a kit | Teammates and Claude Code-style run it through workforce, whose workers file and take tasks on a board (README: "a task board they share with you"). The kit surface that serves it: workforce's flows and roster; harnesses add the `coder` flow and a readiness view. | `README.md:5`; `goals/kits/workforce-and-harnesses-install-as-kits/goal.md:4,7-9` (Teammates serves `agent`, `coder`, `harnesses`, `workforce-roster`) |
| "...and the coding agents it hands work to" come from kits | `harnesses` contributes the `coder` worker flow and a readiness check to workforce; Claude Code fills the harness slot itself; Codex and Cursor are plain harness values an app fills with `fill`. | `packages/harness-manager/src/kit/harnesses-kit.ts:1-21`; `packages/claude-code/src/sdk/kit.ts:1-8,76-80`; `labs/teammates/host.mts:393-398` |
| A kit brings its flows | A kit's `install` "returns the flows it serves". | `packages/core/src/kit/define-kit.ts:96-98,148-151` |
| ...the files it reads from your repo | A kit may own a folder in the app (`directory`): `path` is its default, and the app overrides it with `directory` in the kit's config. The workforce kit's folder defaults to `workforce/`. | `packages/core/src/kit/define-kit.ts:138-147`; `packages/workforce/src/kit/workforce-kit.ts:168-181` |
| ...and its views, the lists and details your pages show | A flow declares views: "blocks a screen watches", each with a scope (`session`, or `user` / `org`) and, for a list, a row key. A view writes nothing and calls no model. Kits' views ride on the flows their install returns. Examples served: workforce's roster view, the harness kit's `readiness` view. | `packages/core/src/types/flow.ts:607-624`; `packages/core/src/kit/define-kit.ts:9-10`; `packages/harness-manager/src/kit/harnesses-kit.ts:16-18`; `goals/kits/workforce-and-harnesses-install-as-kits/goal.md:8-10` |
| A kit can leave openings, called slots, for other kits | A kit declares `slots`, "the typed places other kits fill". Two shapes: keyed (entries by key) and list (appended in install order). A slot's entries are checked against its schema. | `packages/core/src/kit/define-kit.ts:6-9,22-44,124` |
| `harnesses` opens a slot for coding agents; `claudeCode` fills it | `harnesses` declares `slots: { harnesses: slot.keyed(harnessSchema) }`; `claudeCode` `contributes` into `harnesses.slots.harnesses`. | `packages/harness-manager/src/kit/harnesses-kit.ts:96-100`; `packages/claude-code/src/sdk/kit.ts:72-80` |
| The figure: "harnesses fills one in workforce" | `harnesses` `contributes` the `coder` flow into `workforce.slots.workerFlows` and a readiness capability into `workforce.slots.uses`. | `packages/harness-manager/src/kit/harnesses-kit.ts:101-108` |
| A kit names the kits whose slots it fills | `requires`: "The kits this one installs after, and may fill the slots of". Only a kit that requires a slot's owner can fill it; any other fill is refused. | `packages/core/src/kit/define-kit.ts:120-124`; `packages/engine/src/flowstate/types.ts:131-135`; `goals/kits/install-in-any-order/goal.md:11` (`b:unrequired`) |
| ...and never reaches into how they work | What a kit gives is only what the slot's schema accepts, and it contributes by slot key. (State it as: it fills a slot; it does not edit the other kit's code.) | `packages/core/src/kit/define-kit.ts:124-137` |
| A kit that fills a slot can open slots of its own, so features stack | `harnesses` both requires `workforce` (fills its slots) and declares its own `harnesses` slot, which `claudeCode` then fills. | `packages/harness-manager/src/kit/harnesses-kit.ts:96-108`; `packages/claude-code/src/sdk/kit.ts:72-80` |
| An app can switch one fill off | `kit().without(slot, key?)` returns a copy with that contribution dropped. | `packages/core/src/kit/define-kit.ts:166-171`; `packages/claude-code/src/sdk/kit.ts:18-20` |
| An app fills a slot itself | `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] }`. | `packages/engine/src/flowstate/types.ts:139-145`; `labs/teammates/host.mts:393-398` |
| "That is how one developer's app becomes the base for another's" | No source states this. Drop the sentence, or keep only that a kit's slots are filled by kits that require it. | (none) |

**Cut candidates.** Slot shapes (keyed, list), `.without`, `fill` and the ordering rules are Reference or
C-12. The page keeps: a kit is one line, it brings flows, files and views, it may leave slots, and
`requires` is how a kit says whose slots it fills. Slot stacking is one sentence and a link to C-12
(owner note in the sitemap entry).

## "Kits are made of flows and blocks"

| Claim | Fact | Source |
| --- | --- | --- |
| A flow is a backend you call over HTTP | Registering a flow gives "action execution, session management, SSE streaming, and state snapshots without writing routes", for example `POST /api/flows/my-app/actions/chat`, `GET .../requests/:id/stream`, `GET /api/flows/sessions/:id/state`. | `apps/docs/docs/intro.md:71-81`; `apps/docs/docs/fundamentals/overview.md:26` |
| A client runs one of its actions, such as `chat` | A flow's `actions` are its entry points; the example flow's action is `chat`. | `examples/hello-chat/src/flows/hello-chat/flow.ts:79-82`; `apps/docs/docs/fundamentals/overview.md:26` |
| The flow streams results back as it produces them | Items stream with lifecycle added, content.delta, done and a sequence number; a client can resume from a cursor. | `apps/docs/docs/fundamentals/overview.md:42`; `apps/docs/docs/intro.md:81` |
| ...and keeps typed state between calls | State has four scopes (request, session, user, org); only the fields a scope's `client` config exposes reach the browser. | `apps/docs/docs/intro.md:58-69,78`; `apps/docs/docs/fundamentals/overview.md:30-38` |
| Flows hold actions, views, state, resources (figure) | `defineFlow` options include `actions`, `views`, `session`/`user`/`org` state and `resources`. | `packages/core/src/types/flow.ts:607-624` (`views`, `session`, `request`, `user`, `org`); `apps/docs/docs/intro.md:14-38` |
| Five block types | The five are `handler`, `generator`, `evaluator`, `sequencer` and `router`. | `packages/core/src/types/block.ts:43`; `apps/docs/docs/intro.md:42-52`; `apps/docs/docs/fundamentals/overview.md:12-22` |
| Generator: calls a model | "LLM calls. The framework manages prompt assembly, tool loops, streaming, and structured output." | `apps/docs/docs/fundamentals/overview.md:16`; `apps/docs/docs/intro.md:48` |
| Handler: runs your code | "Deterministic compute: validate, transform, mutate state, implement a tool." | `apps/docs/docs/intro.md:50` |
| Sequencer: chains blocks into steps | "Chains blocks: steps, parallel work, loops, rescue. A sequencer is itself a block." | `apps/docs/docs/intro.md:51`; `apps/docs/docs/sequencers/overview.md` ("Sequencers are blocks") |
| Router: picks one block to run | "Picks one child block at runtime." | `apps/docs/docs/intro.md:52` |
| Evaluator: asks a model a typed question | "Asks a model typed questions (which option, what score, yes or no) and returns typed answers." | `apps/docs/docs/intro.md:49`; `apps/docs/docs/fundamentals/overview.md:18` |
| Blocks nest inside one another | "Blocks inside blocks. Sequencers as tools. Routers dispatching to sequencers." | `apps/docs/docs/fundamentals/overview.md:46-48`; `apps/docs/docs/sequencers/overview.md` ("Sequencers are blocks") |
| Any block can be handed to a model as a tool, a pipeline included | "A generator's `tools` array accepts handlers, sequencers, routers — anything with the block contract. ... a single tool call can trigger an entire multi-step pipeline." The framework runs the pipeline and returns its output as the tool result. | `apps/docs/docs/fundamentals/blocks.md:124-152`; `apps/docs/docs/sequencers/overview.md` ("Sequencers are blocks", the `tools: [inner]` example) |
| The model decides when to call a tool from the block's `name` and `description` | "The model calls a tool by the block's `name` and decides when to call it from the block's `description`." The draft's `research` sequencer has no `description`; add one, or give it `.as({ name, description })`. | `apps/docs/docs/fundamentals/blocks.md:158` (the `.as()` section) |
| The example's calls | `generator({ name, model, prompt, tools })` with `model: "openai/gpt-6-luna"`, `sequencer({ name }).step(a).step(b).step(c)`. | `apps/docs/docs/fundamentals/blocks.md:124-152`; `apps/docs/docs/intro.md:17-30`; `packages/core/src/blocks/generator.ts:2809`; `packages/core/src/blocks/sequencer.ts:2576` |
| `planQueries`, `runSearches`, `summarize` are blocks in sibling files | They are made-up names. The page must say what each is, in a clause (user-docs.md "A page does not have to show every file it imports"). The draft's inline comments do. Chaining needs each step's output to fit the next step's input; a connector reshapes it when it does not. | `docs/contributing/user-docs.md:302-312`; `apps/docs/docs/sequencers/overview.md` ("Output flows forward") |
| "You decide, step by step, where the model chooses and where your code does" | In the example, two steps are generators and one is a handler. That is the observable meaning. | `apps/docs/docs/fundamentals/overview.md:14-22` |
| Every kit sits on flows | A kit's `install` returns flows; resources, views and capabilities "ride on the flows the install returns". | `packages/core/src/kit/define-kit.ts:9-10,96-98` |

## The layers (figure)

| Layer, top to bottom | Verb | Fact | Source |
| --- | --- | --- | --- |
| Starter | run | A complete app: pages, a team, the flows. Run with `pnpm --filter @flow-state-dev/teammates dev` (or `claude-code-style`); the command builds pages and serves them with the backend. It needs Node.js 22.18+ and pnpm 10.4.1, and a model key. | `README.md:21,30-59` |
| Kits | install | One config object each, listed in `createFlowState({ kits })`. | `packages/core/src/kit/define-kit.ts:1-5`; `packages/engine/src/flowstate/types.ts:124-137` |
| Flows | call | Actions, views, state, resources; "register a flow ... you get ... HTTP". | `apps/docs/docs/intro.md:71-81`; `packages/core/src/types/flow.ts:607-624` |
| Blocks | write | Five kinds with one typed contract: "input in, output out". | `apps/docs/docs/fundamentals/overview.md:22`; `apps/docs/docs/intro.md:44` |
| Engine | runs them | `@flow-state-dev/engine`: "The runtime. Register flows, execute actions, stream results". Hosting is by adapter (Next.js, Vercel, Node, Lambda); the app hosts it. | `packages/engine/README.md:3`; `apps/docs/docs/server/host-adapters.md:8-10`; `README.md:13,121` |

The figure's arrow (a kit fills a slot another kit opened): `claudeCode` fills `harnesses`'s slot,
and `harnesses` fills `workforce`'s slots (rows above).

## "You build it with an agent"

| Claim | Fact | Source |
| --- | --- | --- |
| Every flow runs from a terminal, no server, no browser | "The CLI runs the same `runAction` engine the production server uses, against the same stores ... No browser, no HTTP server, no mock harness." | `apps/docs/docs/cli/agent-dev-loop.md:8` |
| The command | `fsdev run <flowKind> <action>`, with `-i, --input <json>`. The example `pnpm fsdev run hello-chat chat -i '{"message": "Hello!"}'` matches the hello-chat example (`kind: "hello-chat"`, action `chat`, input `message`). Run from the app's directory. | `packages/fsdev/src/commands/run.ts:132-134`; `examples/hello-chat/src/flows/hello-chat/flow.ts:22,79-82`; `examples/hello-chat/README.md:27`; `apps/docs/docs/cli/agent-dev-loop.md:13` |
| The run prints one JSON event per line | "Stdout streams NDJSON events — `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`." Runtime logs go to stderr. | `apps/docs/docs/cli/agent-dev-loop.md:16`; `packages/fsdev/src/commands/run.ts:56-67` (`FlowEvent`) |
| With a config, `fsdev run` uses the app's models and stores | "When the app under test ships an `fsdev.config.ts`, `fsdev run` uses its models and stores instead of CLI defaults." Config search is the current directory only. | `apps/docs/docs/cli/agent-dev-loop.md:33`; `packages/fsdev/src/load-config.ts:75` |
| A coding agent can write a flow, run it, read what happened and fix it | "If you're a developer (or a coding agent) iterating on a flow, this is your loop. Edit a block, run `fsdev run`, read the NDJSON, repeat." | `apps/docs/docs/cli/agent-dev-loop.md:8-17` |
| "Flow State is meant to be built this way" | No existing page states this as a design aim. Soften to what the loop does, or cut. | (none; see `apps/docs/docs/cli/agent-dev-loop.md:8`) |
| **Limit:** `fsdev run` with a kit app | A run is a user in an organization, like any request; `fsdev run` stops before it writes anything when a run's identity cannot be resolved. | `apps/docs/docs/cli/configuration.md:119-143` |

The link target, "Build with your coding agent" (S-4), is not written yet. Link by its plan slug.

## "Where it stands"

| Claim | Fact | Source |
| --- | --- | --- |
| Open source | The repository is MIT-licensed. | `LICENSE:1-3`; `packages/engine/package.json:60` |
| Written in TypeScript | Stated by the root README. | `README.md:13` |
| Runs as a web service you host | "It is open source, written in TypeScript, and runs as a web service." Hosting is by adapter. | `README.md:13`; `apps/docs/docs/server/host-adapters.md:8-12` |
| Early preview | "It is also an early preview: the starters are research software, and each one's README lists what isn't wired yet." | `README.md:13` |
| Each starter's README lists what isn't wired yet | Starter READMEs exist: `labs/teammates/README.md` (scope: "core messaging and session management. There are no group chats, no new-chat button and no session list", line 77-79) and `labs/claude-code-style/README.md`. | `README.md:13`; `labs/teammates/README.md:77-79` |
| Model providers | Any provider, on a direct key (OpenAI, Anthropic, Google) or a gateway (Vercel AI Gateway, OpenRouter). The model is chosen per block. | `README.md:7,11,111` |
| Coding agents | Claude Code, Codex and Cursor, on the user's existing sign-ins. | `README.md:8,52-54` |
| "Today it's for developers" | Stated by the root README. | `README.md:15` |

## Next-step targets

The page links to three pages in the plan, by slug: Run a starter (`./run-a-starter.md`), How it fits
together (`../concepts/how-it-fits-together.md`, per the sitemap's fix), Add to an existing app
(`./add-to-an-existing-app.md`). Facts the links promise:

| Link text claims | Fact | Source |
| --- | --- | --- |
| Run a starter takes "about ten minutes and one API key" | The README's steps: clone, `pnpm install`, `pnpm build:assets` (one time), `pnpm --filter ... dev`, one model key. No source states "ten minutes". Drop the time or measure it. | `README.md:30-57` |
| Add to an existing app is the way in with a product you already have | "Flow State also mounts inside an existing Next.js App Router or Node project." Install: `pnpm add @flow-state-dev/core @flow-state-dev/engine zod`. | `README.md:97-107` |

## The page's four reader questions: what the facts answer

1. **Cite sources differently: edit what, in which language?** The researcher's `WORKER.md` body, in
   Markdown. Restart the app. (`README.md:65,82`; `labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md:9-12` says "Say where each fact came from")
2. **Give the app a feature someone else built?** Add the kit's call to `createFlowState({ kits })`.
   (`packages/core/src/kit/define-kit.ts:1-5`; `packages/engine/src/flowstate/types.ts:124-137`)
3. **Layers, top down; which must you understand to run a starter?** Starter, kits, flows, blocks,
   engine. None of the lower four to run a starter; the reader starts at the top and goes down only as
   far as needed. (`README.md:30-59`; figure rows above)
4. **Where do code and data live?** Code (worker files, flows, kits listed in config, React pages) in the
   repo; data (conversations, tasks, state, memory, a user's own workers) in the store, a SQLite file
   under `.fsdev/` in the starters. (`README.md:11,59`; `apps/docs/docs/workforce/durable-hire.md`)

## Not on any allowed source

Leave out, or confirm before stating:

- "one developer's app becomes the base for another's" (no source).
- "meant to be built this way" with a coding agent (no source).
- "about ten minutes" (no source).
- A third starter or a hosted service. README lists two starters and Shift Manager "in progress".
- Anything beyond the "The ideas" rows below. The glossary wording for a flow in
  `docs/contributing/user-docs.md:333-338` is the standard, not a fact source; the rows below cite code and user docs.

## "The ideas" (the section the sitemap adds)

Three framework-wide ideas that Concepts pages build on and do not restate. Each row is observable
behaviour with a source. Keep each to a short paragraph on the page.

| Idea | Fact | Source |
| --- | --- | --- |
| A flow is a self-contained unit you register | "A flow is the top-level unit: the thing you register with the server and clients connect to. It ties together your blocks, actions, state, resources, and client data into a single, deployable definition." It is "the complete specification of an AI-powered feature: what actions users can trigger, what state is tracked, and what data is exposed to the frontend". | `apps/docs/docs/fundamentals/flows.md:10-12` |
| A flow has an address of its own | A flow has a `kind`, "Unique identifier, becomes the URL path": `/api/flows/<kind>/...`, and `fsdev run <kind>`. | `apps/docs/docs/fundamentals/flows.md:23`; `packages/core/src/types/flow.ts:497-499` |
| A flow has its own data | State and resources are declared per flow; a session is owned by one flow, and naming it through another is refused with 409 `wrong-instance-session`. | `apps/docs/docs/fundamentals/flows.md:77` (figure description); `packages/core/src/types/flow.ts:688-689` |
| Definition is like a class, a registered flow an instance | `defineFlow()` returns a FlowType, a factory; calling it creates a FlowInstance, "the thing you actually register". A flow is a singleton by default (instance id = `kind`); a `collection` flow can have several named, configured copies. | `apps/docs/docs/fundamentals/flows.md:65-95`; `packages/core/src/types/flow.ts:495-510` |
| What a flow does inside is open | The reference flow is an action running a block pipeline; flows also take webhooks, schedules and an MCP entry point, so they are not only chat. | `packages/core/src/types/flow.ts:644,652,661`; `apps/docs/docs/fundamentals/flows.md:77` (figure description) |
| Everything is a block | "Every piece of logic is exactly one of five kinds"; "All blocks share the same typed contract: input in, output out. Any block composes with any other." A sequencer "is itself a block"; "A tool call can be a handler, a sequencer, or a router. There is no separate 'agent' primitive." | `apps/docs/docs/fundamentals/overview.md:12-22`; `apps/docs/docs/intro.md:42-56`; `packages/core/src/types/block.ts:43` |
| Everything composes | "Blocks inside blocks. Sequencers as tools. Routers dispatching to sequencers." Type safety from flow definition through the client SDK to React hooks; one Zod schema validated at runtime and inferred at compile time. | `apps/docs/docs/fundamentals/overview.md:46-48` |
| State is declared where it is used | "You don't have to declare every state field at the flow level. When a flow is constructed, state declarations on individual blocks bubble up and merge into the flow's combined schema." Example: a `counter` handler declares `sessionStateSchema: z.object({ messageCount: z.number().default(0) })`. | `apps/docs/docs/fundamentals/state-and-scopes.md:80-139` |
| Resources are declared where used too | "Blocks can declare resource dependencies directly with a flat `resources` map." `defineFlow` collects them from action blocks and from blocks in a generator's `tools` array and merges them into the flow's `resources`. Sequencers merge their children's. A flow-level declaration of the same name takes priority and must be the same `defineResource()` object. Tools returned by a `tools` function are not collected. | `apps/docs/docs/fundamentals/flows.md:362`; `apps/docs/docs/fundamentals/blocks.md:790-794`; `apps/docs/docs/resources/overview.md:329-360` |
| What it buys the reader | A block that declares its state and resources works in any flow it is included in, with nothing repeated at the flow: "blocks bring their own resource requirements ... you don't have to repeat them in the flow definition". A request loads only the resources the dispatched action's blocks declare. | `apps/docs/docs/fundamentals/state-and-scopes.md:80,139`; `apps/docs/docs/fundamentals/blocks.md:793-794`; `apps/docs/docs/resources/overview.md:63-65` |

Note for the writer: the sitemap asks that the slot-stacking explanation shrink to one sentence and
link C-12. The only slot facts the page needs are the three rows above in "A kit is a feature you
install" (a slot is an opening a kit leaves for others; `harnesses` opens one and `claudeCode` fills it).

## Revise round 1 notes

- C1, C2 applied: `workforce` imports from `@flow-state-dev/workforce/kit`; `harnesses({ workspace })` takes a `WorkspaceHost` built with `localWorkspaceHost({ root, remotes: { allow }, localRepositories, source })` (`packages/harness-manager/src/kit/harnesses-kit.ts:46-50`; `packages/workspace/src/local-host.ts:194-203,656`; same shape as `labs/teammates/host.mts:320-326`). The config example type-checks.
- The research example is now self-contained (`planQueries`, `runSearches`, `summarize` defined in the file) and type-checks.
- Crash resume is stated with its condition: it needs durable execution, which is on by default over stores that persist (SQLite, Postgres) and off over in-memory stores (`packages/engine/src/flowstate/types.ts:319-333`; `docs/architecture/execution-and-errors.md:193`).
- Flow definition now reads "a self-contained part of your backend, with actions that clients call over HTTP" (`apps/docs/docs/fundamentals/flows.md:10-12`).
- Moved to Reference: the `requires` rule (a kit names the kits whose slots it fills; no access to their internals) is R-11 (`../reference/kits.md`); the `fsdev run` NDJSON output format is R-35 (`../reference/cli.md`). The page links both and states neither.
- The "one developer's app becomes the base for another's" sentence is replaced by the stacking fact from `harnesses-kit.ts:96-108` and `claude-code/src/sdk/kit.ts:72-80`.

## Revise round 2 notes

- Kits (`kits` list): one factory call per kit, order irrelevant, `harnesses` requires `workforce`, a missing required kit is refused at build (`packages/engine/src/flowstate/types.ts:124-137`; `packages/engine/src/flowstate/kits.ts:1-20`; `packages/harness-manager/src/kit/harnesses-kit.ts:96-108`).
- Alice and Bob: an edit of a standard worker is the user's own copy under the same id, one row in her user scope at `workforce/workers/<id>`; `WORKER.md` is never written; Bob sees the standard worker (`packages/workforce/test/worker-roster.test.ts:259-296`; `apps/docs/docs/workforce/durable-hire.md` "What is stored", "Who can reach a worker").
- Code in the repo (worker files, flows, kits in config, pages); data in the database (conversations, tasks, state, memory, a user's own workers) (`README.md:11,59`).
- Stray file or unparseable `WORKER.md` stops the start and is named (`packages/core/src/kit/define-kit.ts:68-75`; `packages/workforce/test/workforce-kit.test.ts:75-121`).
- Crash: durable execution on by default over persisting stores, off over in-memory unless forced; the continued request replays completed work under the same request id (`packages/engine/src/flowstate/types.ts:319-333`; `goals/continue-interrupted-run/continues-not-restarts/goal.md:4-6`; `labs/teammates/host.mts:400,403`).
