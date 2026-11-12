# Sitemap · Reference

[Index](README.md) · [Start](start.md) · [Concepts](concepts.md) · [Catalog](catalog.md) · [Build](build.md) · **Reference**

Forty-three hand-written pages and one generated section per published package. Type
`reference`: tables and signatures, no narrative, no word budget.

- **Hand-written pages** are written by **FIX-2699**. They hold behaviour a user can observe and
  depend on, as tables (O3), including every row the depth pass moves off a Concepts page (D6).
  Framework internals and history are deleted, not moved.
- **Generated API pages** come from doc comments, by **FIX-2698**.
- Every hand-written page opens with one sentence saying what it covers and a link back to its
  concept page. It has no examples beyond a signature or a one-line call per row.
- **Figures.** A page whose subject is a state machine gets one state figure, named below. No
  other Reference page has a figure. Marks: arrow (`MOVES TO`), red on failure states, hatching
  on states that are stored across requests.

"Lookups" are the cold-read questions for a Reference page: a reader, or a coding agent, with
only this page must be able to answer them.

---

## Building blocks

**R-01 · Blocks** · `reference/blocks`
Tables: fields every block takes · options per kind (handler, generator, evaluator, sequencer, router) · block state and sequencer state · state targets and parents · what a block may return. Lookups: Which fields are required on a handler? · What does a router do when no route matches? · Where does a block's own state live, and who can read it? Sources: `configuration/blocks` · `fundamentals/blocks` (the rest) · `advanced/block-state`, `sequencer-state`, `state-targets-and-parents` (merged). From: C-02, C-07.

**R-02 · Generators** · `reference/generators`
Tables: generator options · the context slot and formatters · tool-loop limits · output schemas · what is recorded per call. Lookups: What ends a tool loop? · In what order is context assembled? Sources: `advanced/generator-context` · `fundamentals/blocks` (generator rows). From: C-03.

**R-03 · Sequencer methods** · `reference/sequencer-methods`
Tables: every method with its input, output and conditional variant · connectors · waiting on a condition · side chains: what they may and may not do. Lookups: What does `.parallel()` hand the next step? · Does a side chain's failure fail the request? · What does a wait resume on? Sources: `sequencers/control-flow`, `connectors`, `wait-for-condition` · `advanced/sequencer-side-chains` (delete the changelog). From: C-04.

**R-04 · Utility blocks** · `reference/utility-blocks`
Tables: each shipped utility block: what it does, input, output. Lookups: Which block reshapes without a handler? Sources: `patterns/utility-blocks/core`. From: C-04.

**R-05 · Flows and actions** · `reference/flows`
Tables: every `defineFlow` field · action fields · session settings · running several copies of one flow · isolation flags · lifecycle hooks. Lookups: What does a request name to reach one copy of a flow? · When does `onFinished` fire? · What does `isolateUserState` change? Sources: `configuration/flow` · `fundamentals/flows` (cardinality, settings) · `advanced/flow-isolation`. From: C-05, C-07, C-17.

**R-38 · Type helpers** · `reference/type-helpers`
Tables: each helper type: what it extracts and from what. Lookups: How do you get an action's input type on the client? Sources: `fundamentals/type-system` (helper tables). From: C-02.

## State, data and the stream

**R-06 · Items and the stream** · `reference/items`
Tables: every item type and its fields · item lifecycle · visibility · what persists · the wire format · resume by sequence number · heartbeat · trace events. Figure: *An item's life*, a state figure. Lookups: Which items are never stored? · What does a client send to resume? · Which items does the model see on the next turn? Sources: `streaming/items` · `streaming/overview` (tables) · `streaming/trace-channel` · `server/connection-resilience` (rows). From: C-06, S-4.

**R-07 · State operations** · `reference/state-operations`
Tables: every operation: what it takes, what it returns, when a write is a no-op · equality rules · concurrent writes. Lookups: What does a patch return when nothing changed? · Two blocks write one field in parallel: which wins? Sources: `fundamentals/state-operations` · `state/mutation-model` (observable rows only; internals cut). From: C-07.

**R-08 · Resources and collections** · `reference/resources`
Tables: `defineResource` fields · storage kinds · identity: path, scope, uri · collection operations · search and edges · the manifest · HTTP and hook access · when a resource loads. Lookups: What is a resource's full storage key? · Which resources load for a request? · What can the browser read without `expose`? Sources: `resources/collections`, `client-access`, `manifest`, `storage` (tables) · `resources/overview` (rows). From: C-08, B-34 to B-37.

**R-09 · Views** · `reference/views`
Tables: `defineView` fields · scopes · row keys · definition-time refusals · when a view is read again. Lookups: Which scopes may a view have? · What is refused when a view is declared? Sources: `defineView` doc comments and tests. From: C-09.

**R-10 · Capabilities** · `reference/capabilities`
Tables: `defineCapability` fields · presets · open config · static and dynamic `uses` · what each installs and when. Lookups: Can a dynamic `uses` entry install a resource? · How are presets turned off? Sources: `fundamentals/capabilities` (tables) · `advanced/capabilities-authoring`. From: C-11, B-32.

**R-11 · Kits and slots** · `reference/kits`
Tables: `defineKit` fields · slot kinds · install order · startup refusals and what each names · a kit's folder · `fill` and `without`. Lookups: What stops an app from starting, and what does the error name? · How do you drop one kit's contribution to a slot? Sources: the exported kit surface, its doc comments and tests · `goals/kits/`. From: C-12, B-04. Unsettled: written against the merged, unreleased surface.

## Running it

**R-12 · Runtime configuration** · `reference/runtime`
Tables: every `createFlowState` field · store profiles · settings · async start. Lookups: Which fields are required? · How is a store profile chosen? Sources: `configuration/runtime`, `configuration/overview` · `server/setup` (settings, profiles). From: C-13, S-5.

**R-13 · HTTP API** · `reference/http-api`
Tables: every endpoint: method, path, body, response · the request lifecycle · reaching one copy of a flow · status codes. Lookups: Which endpoint starts an action? · What does a wrong session return? Sources: `server/setup` (endpoints, lifecycle) · `resources/client-access` (HTTP). From: C-05, C-13.

**R-14 · Client configuration** · `reference/client`
Tables: `createClient` options · `FlowProvider` props · what hooks inherit. Lookups: What must `createClient` be given? Sources: `configuration/client`. From: C-10.

**R-15 · Environment variables** · `reference/environment`
Tables: every variable, what reads it, its default. Lookups: Which variable holds each provider's key? Sources: `configuration/environment`. From: S-2, C-18.

**R-16 · Stores** · `reference/stores`
Tables: what each store persists · who owns a record and what keys it · what a custom store must guarantee · session lookup by metadata · cost per request. Lookups: What must a custom store do atomically? · Which records carry an organization? Sources: `persistence/overview` (custom stores, ownership tables). From: C-14, B-31.

**R-17 · Pause, resume and replay** · `reference/durable-execution`
Tables: what `suspend` returns · what runs again on resume · idempotency keys · several pauses in one run · pausing in generators and routers · retention and cleanup · errors. Figure: *A request's states*, a state figure. Lookups: Which blocks are skipped on resume? · How long is a paused run kept? · What happens to a pause nobody resolves? Sources: `advanced/durable-execution` (the rest) · `advanced/block-memoization-and-replay`, `advanced/idempotency`. From: C-15, B-03.

**R-18 · Concurrency policies** · `reference/concurrency`
Tables: each policy: what a second request on one session does. Lookups: What is the default? · Which policy queues? Sources: `advanced/concurrency-policies` (keep, trim). From: C-15.

**R-19 · Background work** · `reference/background-work`
Tables: side chains, queued runs, dispatch: options, what each outlives, how each fails, how each is watched. Lookups: What happens to a queued run when the worker dies? · How does a page follow dispatched work? Sources: `server/background-work`. From: C-16, B-19.

**R-20 · Authentication and tenancy** · `reference/authentication`
Tables: resolver signature · resolution order · what `requireUser` does and does not do · the session consistency check · tenant isolation · sharing resolvers across flows. Lookups: Which resolver wins when two apply? · What is checked when a session id is sent? Sources: `server/authentication` (the rest) · `persistence/overview` (tenant isolation). From: C-17.

**R-21 · Models** · `reference/models`
Tables: model string format · intents · fallback and retry · gateways · prompt caching · reasoning settings · custom resolvers · what is recorded about the model that answered. Lookups: In what order are fallbacks tried? · How do you override an intent per environment? Sources: `fundamentals/models` (tables; migration and roadmap notes cut) · `advanced/custom-model-resolver`. From: C-18.

**R-22 · Errors** · `reference/errors`
Tables: error shapes the client receives · codes · what is captured and where · hooks. Lookups: What does the client get when a block throws? · Which errors are retried? Sources: `advanced/error-handling`, `error-capture` (tables). From: C-19, B-20.

**R-32 · Webhooks and inbound transports** · `reference/webhooks`
Tables: binding fields · verification · mapping to an action · who the caller is · writing a transport. Lookups: What is returned to a sender whose signature fails? Sources: `server/webhooks` (keep, trim) · `advanced/inbound-transports`. From: C-13, B-12 to B-14.

**R-33 · Schedules** · `reference/schedules`
Tables: schedule fields · the tick endpoint · the schedule index · who a scheduled run belongs to. Lookups: What calls the tick? · How is a missed tick handled? Sources: `server/scheduled` (endpoint half) · `server/schedule-index`. From: C-13, B-15 to B-18.

**R-34 · MCP server** · `reference/mcp-server`
Tables: settings · how actions map to tools · caller identity. Lookups: Which actions are exposed by default? Sources: `server/mcp` (tables). From: B-30.

**R-43 · Voice** · `reference/voice`
Tables: server and flow settings · providers · the transcription endpoint · audio content type. Lookups: What is the first-chunk timeout? Sources: `advanced/voice` (tables). From: K-43.

## Getting work done

**R-23 · Task board** · `reference/task-board`
Tables: `taskBoard` options · task statuses and what moves a task between them · stop reasons · concurrency · retries · where the list is stored and how long each choice lasts · assignees that dispatch. Figure: *A task's states*, a state figure. Lookups: What cancels a task? · Which stop reason means a task is waiting on a user? · What does `maxAttempts` change? Sources: `orchestration/task-board` (the rest; "Assignees that dispatch" becomes its own table; Migrating cut) · `orchestration/configuration` (board rows). From: C-21, B-02.

**R-24 · Task collections** · `reference/task-collections`
Tables: the task record · collection operations · claim rules a user can observe · what a newly started task knows about earlier work. Lookups: Can two drains run one task? · What does a task see of its dependencies? Sources: `orchestration/task-substrate`, `orchestration/flow-policy`. From: C-21.

**R-25 · Workforce** · `reference/workforce`
Tables: kit and hire options · the roster: standard, edited, forked, hired · refusals and what each names · coordinator routing modes · discovery output · projects and workstreams · inventory · usage. Lookups: What happens when a user edits a standard worker? · Which worker may hand work to which? Sources: `workforce/workers-on-disk` ("Hiring the roster") · `workforce/coordinators`, `projects`, `durable-hire` (tables) · `workforce/inventory`, `worker-usage`. From: C-22, K-05 to K-13.

**R-26 · Worker messaging** · `reference/worker-messaging`
Tables: message fields · delivery states · refusals · ask-and-wait limits. Figure: *A message's states*, a state figure. Lookups: When is a message refused? · What ends a wait? Sources: `workforce/messaging-workers` (tables). From: K-08.

**R-27 · Harness runs** · `reference/harness-runs`
Tables: kit and workspace options · run states · the verdict contract · the question channel · what a run records: plan, usage, pull requests · per-agent options for Claude Code, Codex, Cursor. Figure: *A run's states*, a state figure. Lookups: What marks a run's task complete? · What happens to the checkout after a run? Sources: `orchestration/harness-manager` (the rest) · `tools/coding-agents`, `claude-code-sdk`, `codex`, `cursor` (tables). From: C-23, K-14 to K-17. Unsettled: kit option names (FIX-2627).

**R-41 · Patterns** · `reference/patterns`
Tables: one config table per pattern, plus `goalSeekLoop` · input and output shapes. Lookups: What is the default round limit for a debate? Sources: the "Config reference" section of each `patterns/*` page · `orchestration/configuration` (loop rows). From: K-19 to K-28.

**R-42 · Tools** · `reference/tools`
Tables: per tool: options, providers, output shape, errors · sandbox providers for Bash. Lookups: Which search providers are supported? Sources: the option tables of each `tools/*` page. From: K-29 to K-35.

**R-37 · Memory** · `reference/memory`
Tables: every memory option by tier · hygiene settings · recall strategies. Lookups: What is the default decay? Sources: `memory/configuration`. From: K-36 to K-39.

## File formats

**R-28 · `WORKER.md`** · `reference/worker-md`
Tables: every setting, its type and default · how the id is formed · what makes a file unusable. Lookups: Which setting is required? · What id does `teams/support/workers/triage` get? Sources: `workforce/workers-on-disk` (settings). From: C-22, S-3.

**R-29 · The workforce folder** · `reference/workforce-folder`
Tables: every path the kit reads and what it becomes · naming rules · who holds a package by where it sits · what is generated. Lookups: Which folder names are refused? Sources: `workforce/documents-on-disk`, `code-on-disk`, `capabilities-on-disk`, `packages-on-disk` (rules). From: K-11.

**R-30 · `SKILL.md` and skills options** · `reference/skill-md`
Tables: frontmatter fields · folder rules · naming rules · library, capability and activator options. Lookups: Which names are refused? · What decides that a skill matches? Sources: `skills/authoring` · `orchestration/configuration` (skills rows) · `skills/binding`, `activation` (tables). From: K-42.

**R-31 · Prompt and resource templates** · `reference/markdown-templates`
Tables: frontmatter fields · variables · how a template is found. Lookups: What happens when a variable is missing? Sources: `advanced/generator-prompts-markdown`, `advanced/resource-templates-markdown`. From: B-22.

## Tools for building

**R-35 · CLI** · `reference/cli`
Tables: every `fsdev` command and flag · the config file · output formats. Lookups: Which flag sets the session? · What does `fsdev block` take? Sources: `cli/overview`, `cli/configuration` (tables) · `api/cli`. From: S-3, S-4, B-29.

**R-36 · UI components** · `reference/ui-components`
Tables: each component and its props, grouped: common, flow-aware. Lookups: Which components need a `FlowProvider`? Sources: `ui/common-components`, `ui/flow-aware-components`. From: C-10, K-40.

## The site's own pages

**R-39 · Glossary** · `reference/glossary`
Generated from `docs/contributing/glossary.mjs`, grouped by layer: app, kit, flow, block, engine. Lookups: What does "worker" mean here? Sources: `glossary` (keep; group by layer). From: every page's first use of a term.

**R-40 · Upgrading** · `reference/upgrading/<release>`
One page per release, and the only place migration notes live. Tables: what changed, what to do. The first is written at cutover from the pending changesets. Sources: every "After upgrading" and "Migrating" section on today's pages, for the current release only; older ones are deleted (O3). FIX-2699 writes the page; FIX-2705 fills it at cutover.

---

## Generated API reference · FIX-2698

One section per published package, generated from doc comments: every export, its signature, its
doc comment and its example. No hand-written prose. The seven `api/*` pages (20,576 words) and
the long READMEs are replaced; nothing is carried over by hand.

| Slug under `reference/api/` | Package | Replaces |
| --- | --- | --- |
| `core` | `@flow-state-dev/core` (and `contracts`, which it re-exports) | `api/core` |
| `engine` | `@flow-state-dev/engine` | `api/server` |
| `client` | `@flow-state-dev/client` | `api/client` |
| `react` | `@flow-state-dev/react` | `api/react`, hook tables in `client/react` |
| `testing` | `@flow-state-dev/testing` | `api/testing`, `api/benchmarks` |
| `fsdev` | `@flow-state-dev/fsdev` | Programmatic exports only; commands are R-35 |
| `devtool` | `@flow-state-dev/devtool` | |
| `node` | `@flow-state-dev/node` | |
| `next` | `@flow-state-dev/next` | |
| `vercel` | `@flow-state-dev/vercel` | |
| `bullmq` | `@flow-state-dev/bullmq` | |
| `mcp` | `@flow-state-dev/mcp` | |
| `scheduled` | `@flow-state-dev/scheduled` | |
| `store-sqlite` | `@flow-state-dev/store-sqlite` | |
| `store-postgres` | `@flow-state-dev/store-postgres` | |
| `orchestration` | `@flow-state-dev/orchestration` | |
| `patterns` | `@flow-state-dev/patterns` | |
| `tools` | `@flow-state-dev/tools` | |
| `workspace` | `@flow-state-dev/workspace` | |
| `memory` | `@flow-state-dev/memory` | |
| `workforce` | `@flow-state-dev/workforce` | |
| `harness-manager` | `@flow-state-dev/harness-manager` | |
| `claude-code` | `@flow-state-dev/claude-code` | |
| `codex` | `@flow-state-dev/codex` | |
| `cursor` | `@flow-state-dev/cursor` | |
| `shift-manager` | `@flow-state-dev/shift-manager` | |
| `voice-openai` | `@flow-state-dev/voice-openai` | |

Twenty-seven sections for twenty-eight published packages. `@flow-state-dev/ui` is distributed
as a registry, not an import, so its reference is R-36. Whether `contracts` gets its own section
is FIX-2698's call.

## Pages that leave user docs

| Today | Goes to |
| --- | --- |
| `testing/flow-integration-tests`, `testing/end-to-end-tests` | Contributor docs |
| `shift-manager/from-a-checkout` | Contributor docs |
| `guides/writing-ui-stories` | Contributor docs |
