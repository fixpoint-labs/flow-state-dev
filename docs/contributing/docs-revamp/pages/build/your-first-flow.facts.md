# Facts for Your first flow (B-01, tutorial)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (`examples/hello-chat`). No spec, no `docs/internal/`, no `CLAUDE.md`. The page plan's Sources line names four existing pages; they were read as existing user docs and checked against code. Where they disagree with code, section 0 says so and the code wins.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `eng` = `packages/engine/src`
- `rx` = `packages/react/src`
- `cli` = `packages/fsdev/src`
- `tst` = `packages/testing/src`
- `hc` = `examples/hello-chat` (the one example; `hc/src/flows/hello-chat/flow.ts` is its flow)
- `old-yff` = `apps/docs/docs/getting-started/your-first-flow.md`
- `old-ps` = `apps/docs/docs/getting-started/project-structure.md`
- `old-qs` = `apps/docs/docs/getting-started/quick-start.md`
- `old-bca` = `apps/docs/guides/building-a-chat-app.md`
- `old-cli` = `apps/docs/docs/cli/overview.md`, `apps/docs/docs/cli/agent-dev-loop.md`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page; the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[ran]** observed by running code in this pass (section 11 lists what was run, and the scaffold the runs used). **[conflict]** two sources disagree; the code wins and the note says which source is wrong. **[decide]** a choice the page writer or caller must make; the facts on both sides are given.

The page's one app is hello-chat (flow kind `hello-chat`, action `chat`). Names in sections 2 to 8 (`cleanMessage`, `countMessage`, `chatGenerator`, `chatPipeline`) are the page's choice, not framework facts; the behaviour under them was run with exactly those names (section 11).

## 0. Where the existing pages are wrong (do not copy)

Every item was checked against the source and by running it.

| Existing pages say | Code does | Evidence |
| --- | --- | --- |
| `createFlowState({ flows: { chatFlow }, ... })`. Every existing page that mounts a server writes the keyed record: `old-qs:107-108`, `old-yff` step 5, `old-ps` (`flows: { chatFlow, agentFlow }`), `old-bca:144-145`, `apps/docs/docs/getting-started/installation.md:73-74`, `apps/docs/docs/getting-started/setting-up-models.md:51-52`. | `flows` is a list: `flows: [chatFlow]`. The record form throws at construction: `FlowStateConfigError: createFlowState: \`flows\` is a list of flows, each served under its own id: \`flows: [readiness, context]\`. The keyed record form was removed.` [ran] | `eng/flowstate/types.ts:119-124` (type `readonly FlowInstance[]`); `eng/flowstate/createFlowState.ts:372-376` (the throw); `hc/fsdev.config.ts:18` (`flows: [helloChatFlow]`) |
| The route file is `app/api/flows/[...path]/route.ts`: `old-qs:125`, `old-yff` step 5, `old-ps`, `old-bca:151`, `packages/next/README.md:18`. | With a required catch-all `[...path]`, `GET /api/flows` returns 404. With an optional catch-all `[[...path]]`, it returns 200 and the flow list. The React hook `useFlow` calls `GET /api/flows` first on mount (`fsd.flows()`), before it lists or creates a session, so a chat page built on the `[...path]` route never creates its session. The example uses `[[...path]]`. [ran: example served on a dev server with each directory name; 200 vs 404] | `hc/app/api/flows/[[...path]]/route.ts`; `client/src/client.ts:735` (`t.json("/api/flows")`); `rx/hooks/useFlow.ts:129` (`await fsd.flows()` on mount). `apps/docs/docs/getting-started/existing-project.md:33` writes a separate `api/flows/route` beside `[...path]/route` for the same reason (inferred; its text says only "mount pair"). The route file belongs to S-5; the page must still show a route that works. **[decide]** whether the tutorial shows the `[[...path]]` route or links S-5 for it. Either way it must not show `[...path]` alone. |
| Tests: `generators: { chat: { output: "Hi there!" } }` and `result.session.state.messageCount` (`old-bca:263-266`, `:279`, `:296`). | `generators` takes `mockGenerator(...)` instances; a bare `{ output }` object is a type error and fails the run. `TestFlowResult` has no `session`. `mockGenerator` takes `name` and `script` only. [ran] | `tst/test-utilities/types.ts:160,191-212`; `tst/mocks/mockGenerator.ts:434-437`. The same finding is on `docs/contributing/docs-revamp/pages/concepts/testing.facts.md` section 0. |
| `fsdev run ... --session <id>`: "State from the previous run is loaded" (`old-cli`, overview line 42; "State persists between runs", line 35). | True only for the CLI's own SQLite store. When the app's `fsdev.config.ts` sets no `stores`, or sets `inMemoryStores()` (as `old-qs:119` and `old-qs:188-194` do), each `fsdev run` starts empty and `--session` carries nothing over. [ran, section 5] | `cli/local-store.ts:1-12`; `eng/flowstate/createFlowState.ts:972` (startup line: "no \`stores\` set: the app runs in memory, and nothing persists across a restart"); `hc/fsdev.config.ts` (no `stores`) |
| `old-qs:188-196`: `fsdev.config.ts` is needed to run the CLI, "Without that file, the CLI never sees the `intent/chat` list ... and the run stops with `unresolved_intent`". | With no config the CLI discovers flows from `src/flows/<dir>/flow.ts` and runs them with a built-in resolver keyed off environment variables. A flow whose generator names a model directly (`openai/gpt-6-luna`) runs with no config file. Only an `intent/...` name needs the app's intent list. [ran: `--no-config` run] | `cli/resolve-flow.ts:36-37,177-199` (scan `src/flows`, `flows`; looks for `flow.ts`, `flow.js`, `index.ts`, `index.js`); `old-cli` overview "Flow discovery" |
| `old-yff` step 5 and `old-ps` mix `src/app/page.tsx` with `app/api/...` and `lib/flowstate.ts`. | The example puts `app/` and `lib/` at the project root and the flow under `src/flows/`, with `@/*` mapped to `./*`, and its route imports the app's config as `@/fsdev.config`. The layout in `docs/contributing/user-docs.md` ("Code examples") puts pages under `src/app/`. The two differ; whichever the page uses, the `@/` alias and the file locations must agree. | `hc/tsconfig.json` (`paths: { "@/*": ["./*"] }`); `hc/app/api/flows/[[...path]]/route.ts:1`; **[decide]**. Next.js's own rule for a project holding both `app/` and `src/app/` is outside the framework: **[verify]**, keep off the page. |
| Node: `old-qs:13` says "Node.js 22 or newer"; `apps/docs/docs/getting-started/existing-project.md:87` says 22.18. | The packages declare `node >=22` (`core` says `>=22.3.0`). The CLI loads a `.ts` config natively when Node can, and falls back to its own loader when it can't, so 22.18 is not a floor. | `cli/package.json:57-59`; `eng/package.json:100-102`; `next/package.json:51-53`; `core/package.json:180-182`; `cli/import-config-module.ts:1-30`. `core` is the highest floor of the packages the page installs, so the page says "Node 22.3 or newer". |

## 1. What you will build (opening, figure 1: *What you build*)

- The finished app is a chat: a user sends a message, the model answers, the page counts the messages sent. Sections 2 to 8 build it. `old-yff` "What we're building"; `hc/src/flows/hello-chat/flow.ts:1-15` (header comment). [page]
- The pieces, by the page's names: two blocks that do work and one the page adds before the reply. A **handler** runs code (`cleanMessage` or `countMessage`). A **generator** asks a model to write (`chatGenerator`). A **sequencer** runs blocks in order (`chatPipeline`). A **flow** exposes the sequencer as the action `chat`. `core/types/block.ts:38-43` (kinds: `handler` runs code, `generator` asks a model to write, `sequencer` and `router` compose other blocks); `hc/src/flows/hello-chat/flow.ts:68-91`. [page: one clause each; figure 1 claim]
- Five block kinds exist; the page uses two of them plus a sequencer, and links to Blocks (C-02) for the rest. `core/types/block.ts:43` (`"handler" | "generator" | "evaluator" | "sequencer" | "router"`). [page: link only]
- A flow is the unit the server registers. It names its **actions**; a client calls an action, never a block. `hc/src/flows/hello-chat/flow.ts:78-91`; `core/types/flow.ts:588-592` (`actions`: "the flow's `public` entries ... what a caller may name over HTTP, MCP or voice"). [page]
- A session is where the flow keeps many requests together; here, one conversation. The count lives in it. `core/types/scope.ts:289-296` (session scope handle: "exposes per-session state and metadata"). [page; define "session" on first use, per `docs/contributing/user-docs.md` Words: not "a conversation"; this page's session happens to be one conversation]
- Figure 1 claim: the one finished flow, `chatPipeline` = `cleanMessage` then `chatGenerator` then `countMessage`, exposed as the action `chat`, with one session holding `messageCount`. Marks (from the plan): arrow `PASSES ITS OUTPUT` between steps, hatching on the session (it outlives the request), dashed outline on the action run (it lasts one action run). The hatching and dashed meanings are the standard's (`docs/contributing/user-docs.md` "Figures", table). [page; figure]

## 2. Start a project (the layout; figure 2: *Where each file goes*)

- There is no scaffolding command for a new project. The CLI's commands are `run`, `block`, `chat`, `dev`, `serve`, `benchmark`, `ui`, `worktrees`, `gen`. `apps/docs/docs/getting-started/existing-project.md:11` ("There is no `fsdev init` command."); `old-cli` overview command table; `cli/commands/` (no `init`). [page: one clause, or just start from "a Next.js app you have"]
- Packages to install, runtime: `@flow-state-dev/core`, `@flow-state-dev/engine`, `@flow-state-dev/next`, `@flow-state-dev/react`, `zod`, and one provider package (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`). Dev: `@flow-state-dev/fsdev`, `@flow-state-dev/testing`, `vitest`. `old-qs:20-31`; `old-yff` step 0; `hc/package.json:15-42`. `ai` and `zod` arrive as dependencies of `core`, but the app imports `zod` itself, so it is installed directly. `core/package.json:184-194`. [page]
- The CLI's default store is SQLite, and pnpm 10 builds `better-sqlite3` only when allowed: `pnpm add -D @flow-state-dev/fsdev --allow-build=better-sqlite3`. `old-qs:21-24`; `cli/package.json:65` (`@flow-state-dev/store-sqlite`); `store-sqlite/package.json:67` (`better-sqlite3`). The pnpm flag's version note (10.4) is outside the framework: **[verify]**, keep off or copy the old sentence unchanged. [page]
- A provider needs its key in the environment: `OPENAI_API_KEY` for `@ai-sdk/openai`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`. The framework detects keys at start. `apps/docs/docs/getting-started/setting-up-models.md:15-39`; `hc/fsdev.config.ts:9-12` (doc comment: the omitted `models` option "auto-detects providers from env vars"). Models and intents are C-xx (Models); the page links. [page: one line, link]
- With no key the run fails with this message on the `error` event and exits 1: `No provider available for "openai". Tried: direct package (not installed), gateways (none configured for this provider). Install the provider package, set its API key, or configure a gateway (e.g. AI_GATEWAY_API_KEY).` [ran: key variables removed from the environment] `cli/exit-codes.ts:15` (`EXIT_EXECUTION_ERROR = 1`). [page: one sentence, so a reader who skipped the key sees what it looks like]
- The five-file layout the tutorial builds (figure 2), under the standard's layout (`docs/contributing/user-docs.md` "Code examples"):

  ```text
  fsdev.config.ts                                   the app's FlowState: flows and stores
  src/
    flows/hello-chat/flow.ts                        defineFlow and its action
    flows/hello-chat/blocks/chat-generator.ts       the generator
    flows/hello-chat/blocks/clean-message.ts        the step before it
    flows/hello-chat/blocks/count-message.ts        the counter
  app/page.tsx                                      the page          (see section 0: `app/` vs `src/app/`)
  app/api/flows/[[...path]]/route.ts                the route         (S-5)
  src/flows/hello-chat/flow.test.ts                 the test          (location is the page's choice; section 8)
  ```

  The plan says "five files"; the scaffold above has four block-and-flow files plus config, page, route and test. **[decide]** which five the figure's highlighter and the prose name. If step 4's handler and step 5's counter are one block, the flow files are `flow.ts`, `chat-generator.ts` and that one handler. [page; figure 2 claim: where each file goes, `flow.ts` highlighted]
- One export per block file, named after the file. `docs/contributing/user-docs.md` "Code examples"; matches `hc` in spirit but the example keeps its blocks in `flow.ts`. [page]
- The flow's file is the one a reader opens to see the whole flow. The CLI finds a flow at `src/flows/<name>/flow.ts` when it is the file's default export; other files in the folder (blocks, tests) are not scanned as flows. `cli/resolve-flow.ts:177-199`. [page: one sentence; it is why `fsdev run hello-chat chat` works before any config exists]
- Which file changes what the model is told: the generator's `prompt` (system instruction), in `blocks/chat-generator.ts`. `core/blocks/generator.ts:608` (`prompt`). [page; answers Q1]

## 3. A generator that answers (step 2)

The generator, as run (`chat-generator.ts`; its `name` is also its address in tests, section 8):

```ts
generator({
  name: "chat-generator",
  model: "openai/gpt-6-luna",
  prompt: "You are a concise, friendly assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});
```

- `generator({ name, model, prompt, inputSchema, history, user, itemVisibility })`. `prompt` is required. `model` is required unless a capability supplies one. `core/blocks/generator.ts:599,608,610,612,585`. [page]
- `model` is a `provider/model-id` string. `openai/gpt-6-luna` is the small, fast example name the docs use. `core/blocks/generator.ts:599`; `apps/docs/docs/getting-started/setting-up-models.md:97-113`. An `intent/chat`-style name points at the app's model list and needs `models.intents`; it is the Models page's subject. [page: direct string only; link Models]
- `prompt` is the system instruction, sent first on every model call. It may be a string or a function of the input. `old-bca:39`; `core/blocks/generator.ts:600-608` (doc comment: inline string, resolver function, array, prompt file). [page: string only]
- `history: true` loads the session's earlier turns into the call, so the model remembers what was said. It reads persisted items, so it needs no wiring on the page. `core/blocks/generator.ts:359-362,779-789` (`true` calls `ctx.session.items.history()`); `hc/src/flows/hello-chat/flow.ts:42-43`. [page; ran: turn 2 of a session sent turn 1's user and assistant messages again, section 6]
- `user: (input) => input.message` builds this turn's user message from the generator's input. `core/blocks/generator.ts:612`. [page]
- `itemVisibility: { client: true, history: true }` marks the generator's messages as shown to the user and kept in history. With it unset the generator emits no items: the model runs and nothing reaches the client. There is no default. `core/blocks/generator.ts:568-584`. [page: one sentence; a chat that shows nothing is the likeliest first mistake]
- With `outputSchema` omitted the generator returns text (`z.string()`) and the reply streams token by token. `hc/src/flows/hello-chat/flow.ts:32-36`; `core/blocks/generator.ts:2865`. [page]
- An action wraps a block. A single generator can be the action's block (`old-qs:57-83`); this page wraps a sequencer. `core/types/flow.ts:201` (`ActionCore.block`). [page: step 2 may expose the generator alone so step 3 can run it before the pipeline exists, but a generator alone then needs `inputSchema` on the action or the generator; `ActionCore.inputSchema` defaults to `block.inputSchema`, `core/types/flow.ts:202-209`]
- The action: `chat: { block, userMessage: (input) => input.message }`. `userMessage` writes the input as a `user` message item when the request starts; that item is what `history` reads on later turns. `core/types/flow.ts:213-219` (doc comment; the field is line 219); `hc/src/flows/hello-chat/flow.ts:82-85`. [page]
- `defineFlow({ kind, requireUser, actions, session })` returns a factory; calling it with no arguments gives the flow instance, the default export. `hc/src/flows/hello-chat/flow.ts:78-95`; `core/flow/defineFlow.ts:1623`. `kind` is the flow's address (`hello-chat`); it is the first argument of `fsdev run` and the URL path. [page]
- `requireUser` defaults to true: a caller must supply a `userId`. In the CLI the user is `devuser` unless `-u` says otherwise. `core/types/flow.ts:575-578`; `cli/commands/run.ts:139` (`-u, --user`); ran: stderr shows `[fsdev] running as devuser in organization __fsd_default_org__ (no resolver configured)`. [page: `userId` appears again in `FlowProvider` and `testFlow`]

## 4. Run it from the terminal (step 3)

- Command: `pnpm fsdev run hello-chat chat -i '{"message":"Hello"}'`, run from the project root. `run <flowKind> <action>`, `-i, --input <json>`. `cli/commands/run.ts:130-134`. [page]
- Stdout is NDJSON, one event per line: `item_added`, `item_updated`, `item_done`, `content_delta`, `state_change`, `flow_complete`, `suspended`, `error`. Stderr carries runtime logs (`[flow-state] ...`, and the `[fsdev] running as ...` line). `--quiet` silences stderr. `cli/commands/run.ts:56-64`; `old-cli` agent-dev-loop lines 14,37-50. [page; ref for the full event list]
- What one successful run of the finished flow emitted, in order (`jq` over the event stream) [ran, three-block pipeline]:
  1. `item_added`/`item_done`, an item of type `message`, role `user`: the `userMessage` echo of the raw input.
  2. `item_added` `block_trace` for `chat-pipeline` (`blockKind: "sequencer"`), then a `block_trace` for each step as it starts and finishes: `clean-message`, `chat-generator`, `count-message`, each with `status` `in_progress` then `completed`.
  3. For the generator: an `item_updated` carrying `generator: { model, prompt, tools, user, history }`, then an assistant `message` item (`item_added`, status `in_progress`), a run of `content_delta` events (`itemId`, `delta`), and `item_done` for the message.
  4. For the counter: an item of type `state_change` with `scope: "session"`, `operation`, `delta`, `version`.
  5. `flow_complete`: `{ "type": "flow_complete", "output": "<the reply text>", "durationMs": 2038, "items": 6 }` (the example flow with two blocks printed `items: 6`).
- **What `fsdev run` shows that the page does not (answers Q2):**
  - The `generator` patch on the generator's trace lists exactly what the model was sent: `model`, `prompt`, `tools`, `user` and `history`, each as `{ role, content }` messages. For input `"  Say   hi  "` through the three-block flow it printed `"user":[{"role":"user","content":"Say hi"}]` and `"history":[{"role":"user","content":"  Say   hi  "}]`. [ran] Section 6 uses this.
  - Per-block traces: each block's name, kind, status, and where its input and output came from (`inline` value or `ref` to another item). For the step before the generator, the trace's `output` was `{"message":"Say hi"}`. [ran]
  - The `state_change` item: which scope changed, the operation, the delta and the new `version`. [ran]
  - Timing and counts on `flow_complete`.
  - That `fsdev run` calls the real model and needs the key: `old-cli` overview line 26 ("a generator still calls its model provider over the network").
- Useful reads: `... --quiet | jq -r 'select(.type=="content_delta") | .delta'` prints the reply as it streamed; `jq 'select(.type=="flow_complete") | .output'` prints the final text. `old-cli` agent-dev-loop lines 41-47. [page: one or two; [ran]: `flow_complete.output` was the reply text]
- A failed run: an invalid input prints an `error` event `Action input validation failed at "message": String must contain at least 1 character(s)` and exits 1. [ran, input `{"message":""}` against `z.string().min(1)`] `hc/src/flows/hello-chat/flow.ts:21-23`. [page: optional, one line, if the action's schema is `.min(1)`]
- `-s <id>` reuses a session. `--seed-session '{"messageCount":5}'` starts it with that session state. Only session state can be seeded. `cli/commands/run.ts:137,140`; `old-cli` overview lines 72-76. [page: `-m <model>` overrides the model for the run, `cli/commands/run.ts:136`; ref]
- `fsdev run` with the app's `fsdev.config.ts` uses the app's stores. With no config file it uses a local SQLite file at `.fsdev/data/fsdev.db`, which `fsdev dev` also reads. `cli/local-store.ts:1-12,25-27`. [page: one sentence, see section 5]
- Related commands, link only: `fsdev chat` (live multi-turn session in the terminal), `fsdev dev` (DevTool in the browser). `old-cli` overview command table. [page: link]

## 5. Keep a count in session state (step 5)

- State is typed data kept in one of four scopes: `request`, `session`, `user`, `org`. The page uses `session` and links State (C-07). `core/types/scope.ts:7`. [page]
- A block declares the session fields it touches with `sessionStateSchema`. `ctx.session.state` is typed from it. `core/blocks/handler.ts:85,193`; `hc/src/flows/hello-chat/flow.ts:58-66`. [page]
- The flow declares the full shape: `session: { stateSchema: z.object({ messageCount: z.number().default(0) }) }`. A new session starts at the schema's default, so the first read is 0. `core/types/flow.ts:358-368` (`SessionConfig.stateSchema`, from line 358); `hc/src/flows/hello-chat/flow.ts:87-91`. [page; ran: first run gave `messageCount` 1 with no seed]
- Block declarations merge up into the flow. A block that declares `sessionStateSchema` makes the flow's own `stateSchema` redundant for that field, but the example declares both. **[decide]** whether the page declares the field once (on the block; `docs/contributing/user-docs.md` Words: "state a block uses is declared on the block and reaches the flow from there, so a flow example does not repeat it") or twice. If once, `client.expose` still needs the key on the flow; confirm by running before writing, because `hc` declares `stateSchema` on the flow and the exposure needs it. **[verify]**: a flow with only `session: { client: { expose: [...] } }` and the field declared on the block was not run. [ran, revise round 1] A flow with no `session` config at all, whose handler declares `sessionStateSchema` and calls `patchState`, runs to `completed` under `testFlow` and its items include `state_change` with delta `{"messageCount":1}`, ahead of the assistant message. So step 4 runs before step 5 declares the flow's `session.stateSchema`.
- Two ways to write the count, both [ran]:
  - `await ctx.session.incState({ messageCount: 1 })` adds the increment in the store, so two requests landing together both count. The `state_change` item's `delta` is the increment, `{"messageCount":1}`, whatever the total. `core/types/state.ts:42`; `old-bca:65-67`.
  - `await ctx.session.patchState({ messageCount: count + 1 })` writes the new total after reading the old one (as `hc` does). The `state_change` item's `delta` is the total: seeded at 5, it printed `{"messageCount":6}`. `core/types/state.ts:35`; `hc/src/flows/hello-chat/flow.ts:58-66`. [ran]
  - **[decide]** which the page uses. `incState` is the simpler counter and is not racy; `patchState` makes `fsdev run`'s `state_change` readable as the total. The page must not claim `incState` shows the total.
- Placement: `.tap(countMessage)` runs a block for its effect and keeps the previous output as the pipeline's output. `.step(block)` replaces the value with the block's return. `core/blocks/sequencer-methods.ts:163,328`; `hc/src/flows/hello-chat/flow.ts:68-73` (comment). [page]
- A tapped handler receives the previous step's value, so its `inputSchema` must match that value. As the last step it takes the generator's text (`z.string()`); as a first step it takes the pipeline's input object. A mismatch fails the run with `Block "count-message" input validation failed: Expected string, received object`. [ran] `core/blocks/internal/build-block.ts:152-170`. [page: one sentence, if the counter's position is discussed]
- **Where the count lives between two messages (answers Q3):** on the session record, in the store. Two runs against one store and one session id left `{"messageCount":2}`; a second session id in the same store held `{"messageCount":1}` and its model call carried none of the first session's turns. [ran: `testFlow` twice on `s1` and once on `s2` over one `createInMemoryStores()`; `stores.session.get`]
- The four storage questions, for each stored part:

  | Part | Who owns it | Who can see it | Where it is stored | How many |
  | --- | --- | --- | --- | --- |
  | Session state (`messageCount`) | The session, which belongs to one user in one organization | Blocks in any request of that session. The browser only sees fields listed in `session.client.expose` (here `messageCount`) | On the session record in the app's store. The example's store is in memory, so a server restart loses it. With no config file the CLI uses SQLite at `.fsdev/data/fsdev.db`. | One per session |
  | Session items (the messages, the traces) | The session | Client: items marked `client: true`. Model: items marked `history: true` (the generator's `itemVisibility`) | Same record store as the session | Many per session, one per message or trace |
  | Request state | Not used on this page | n/a | n/a | n/a |

  Sources: `core/types/scope.ts:289-324` (session handle: `state`, `items`); `core/types/flow.ts:371-374` ("State is private by default — only `expose`d field names appear in `clientData.session`"); `eng/flowstate/types.ts:171-172` (`stores` omitted: "in memory, as the `default` profile. Nothing persists across a restart"); `cli/local-store.ts:1-12`. [page: the table's content in prose; Q3's answer in one sentence]
- Persistence limits, observed: a config whose `stores` is omitted loses the count when the process exits (two `fsdev run -s tut-s1` runs against `hc` each printed `messageCount` 1, version 1). With `--no-config`, two runs on one `-s` id printed 1 then 2 (version 1, then 2). [ran] **[decide]** the page's verification step: either run twice with `--no-config`-style discovery (no `fsdev.config.ts` yet at step 3), or use `--seed-session` to see the delta without needing persistence, or point at `fsdev chat`. Persistence choices (SQLite, Postgres) are the Persistence page's (C-xx); the page links.
- Exposing it: `session: { client: { expose: ["messageCount"] } }` lists the session fields a client may read. State is private unless exposed. `core/types/flow.ts:54-67,371-374`; `hc/src/flows/hello-chat/flow.ts:89`. [page]
- Over HTTP, the exposed value arrives in the session's state snapshot: after one `chat` action the route `GET /api/flows/sessions/:sessionId/state` returned `clientData: { "session": { "messageCount": 1 } }`. [ran, in-process router against `hc`'s config] `client/src/client.ts:652`; `rx/hooks/useSession.ts:360` (`snapshot`). [ref: the endpoint list; the page may name `clientData` once]

## 6. Add a step before it (step 4)

The step, as run (`clean-message.ts`), and the flow it sits in:

```ts
export const cleanMessage = handler({
  name: "clean-message",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ message: z.string() }),
  execute: (input) => ({ message: input.message.trim().replace(/\s+/g, " ") }),
});

sequencer({ name: "chat-pipeline", inputSchema: chatInput })
  .step(cleanMessage)
  .step(chatGenerator)
  .tap(countMessage);
```

- `handler({ name, inputSchema, outputSchema, execute })`. `execute(input, ctx)` returns the output, sync or async. A handler is the kind for non-model work: validate, transform, update state. `core/blocks/handler.ts:110-118,120`; `apps/docs/docs/fundamentals/blocks.md:15-18`. [page]
- `sequencer({ name, inputSchema })` returns a builder. `.step(block)` appends a block whose output becomes the next step's input. The sequencer is itself a block, which is why it can be the action's `block`. `core/blocks/sequencer.ts:2576`; `core/blocks/sequencer-methods.ts:156-166`; `hc/src/flows/hello-chat/flow.ts:71-73,82-84`. [page; Composition (C-04) holds the rest]
- Types carry through the chain: the step before the generator must output what the generator's `inputSchema` accepts, and the generator then runs on that. `core/blocks/sequencer-methods.ts:163-166`. [page; ran: both ends type-checked under `strict`]
- Reading a sequencer's steps: each step has a `block_trace` item with the step block's name; they are the lines `fsdev run` prints in order. [ran, section 4]
- **A step that rewrites the message the model reads makes the model see it twice. [ran] [decide]** The action's `userMessage` writes the raw input as a `user` message item when the request starts, and `history: true` reads that item back. The generator's `user` slot then adds the cleaned text as a second `user` message. When the cleaned text equals the raw text, the framework sends it once. When they differ the model is sent both. Run with raw `"  Hello   world "` and a step that trims and collapses spaces, the mock generator's recorded input was:

  ```json
  [{"role":"system","content":"You are a concise, friendly assistant."},
   {"role":"user","content":"  Hello   world "},
   {"role":"user","content":"Hello world"}]
  ```

  and with raw `"Hello"` it was one `{"role":"user","content":"Hello"}`. Turn 2 of a session with `"  Second  "` sent turn 1's two messages, then `"  Second  "`, then `"Second"`. `core/types/flow.ts:213-219` (`userMessage`: "the request's input as a `user` message item, written when the request starts"); `apps/docs/docs/getting-started/your-first-flow.md` step 4 and `old-bca:131` (the old pages say both slots are wired to one source and the framework "deduplicates equivalent content"; true only for equal content). The `fsdev run` trace shows the two (section 4).
  Options for step 4's handler, each [ran] unless marked:
  - **(A) Do not change the text.** Put the handler first with `.tap(handler)`: `sequencer(...).tap(countMessage).step(chatGenerator)`. The tapped handler's `inputSchema` is the pipeline input. The model was sent one `user` message and `state_change` `delta` was `{"messageCount":1}`. This moves the counter ahead of the reply, so a failed model call still counts. [ran]
  - **(B) Change the text and say what happened.** Keep `cleanMessage` as a `.step` and use the trace to show the two messages. A tutorial that builds a defect in is a poor fit for "every step ends with something the reader can see"; if the page does this, it must state the limit flat ("`userMessage` records the input as sent") and say what to do (leave `userMessage` and `user` pointing at the same, unchanged field, or do the rewrite where the client sends). Not run: setting the action's `userMessage` to a function that cleans the same way (`userMessage: (input) => clean(input.message)`) so the two agree. **[verify]**
  - **(C) A step that adds, not rewrites.** A handler that returns the input plus a field the generator's prompt reads (a `context` slot or `prompt` function) leaves `message` alone. Not run. **[verify]**
- The same step-before shape works for a step that validates and throws; a thrown error fails the run with the error's message on the `error` event. Not run for a handler throw. **[verify]** Keep off the page.

## 7. Put it on a page (step 6)

The page, as type-checked under `strict` (`app/page.tsx`) [ran: `tsc` over the file, no errors]:

```tsx
"use client";
import { FlowProvider, ItemsRenderer, useClientData, useFlow, useSession } from "@flow-state-dev/react";

export default function Page() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <Chat />
    </FlowProvider>
  );
}

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  const { session: data } = useClientData(session, { session: ["messageCount"] });
  // ... <ItemsRenderer items={session.items} /> and a form calling session.sendAction("chat", { message })
}
```

- `FlowProvider` takes `flowKind` and `userId`, and optionally `baseUrl`, `apiPath` (default `"/api/flows"`), `renderers`. Everything beneath it reads them. `rx/context/FlowContext.ts:42-62`. `baseUrl` may be omitted for a same-origin app (`old-qs:146` omits it; `hc/app/page.tsx:29` passes `""`). [page]
- `useFlow({ autoCreateSession: true })` lists the user's sessions for the flow, selects the newest, and creates one when there are none. It returns `activeSessionId`, `sessions`, `createSession`, `selectSession`. `rx/hooks/useFlow.ts:17-56,120-160`. [page]
- `useSession(sessionId)` returns the session's view: `items` (what to draw), `sendAction(action, input)`, `isStreaming`, `canSendAction`, `error`, `snapshot`. `rx/hooks/useSession.ts:338-360,379,441`. `sendAction("chat", { message })` calls the action by name with its input. [page]
- `ItemsRenderer` draws `items`, dispatching on each item's type to a built-in renderer; the generator's messages show because the generator set `itemVisibility.client`. `rx/components/ItemsRenderer.ts:1-30`; `core/blocks/generator.ts:568-584`. Custom renderers go in `FlowProvider`'s `renderers`: link, do not teach (`hc/app/page.tsx:22-25`). [page: one sentence]
- `useClientData(session, { session: ["messageCount"] })` returns the exposed session fields from the latest snapshot: `data.messageCount` is `unknown`-typed by default (cast or schema). `rx/hooks/useClientData.ts:20-30,88-110`. The example reads the same field as `session.snapshot?.clientData?.session?.messageCount` (`hc/app/page.tsx:41-43`). [page: one of the two]
- `canSendAction` is false while a request is in flight, which disables Send; `isStreaming` is true while items are arriving. `rx/hooks/useSession.ts:338,349-350`. [page]
- `useFlow`'s first call on mount is `GET /api/flows`, so the route must answer it. See section 0, the route row. [page: if the route is shown]
- The server side: `fsdev.config.ts` default-exports the `createFlowState` result; the route file imports it and hands it to `createNextHandler`. `hc/fsdev.config.ts:14-22`; `hc/app/api/flows/[[...path]]/route.ts:1-8`; `next/src/index.ts`. Verified shape of the config:

  ```ts
  import { createFlowState } from "@flow-state-dev/engine";
  import helloChat from "./src/flows/hello-chat/flow";

  export default createFlowState({ flows: [helloChat] });
  ```

  [ran: type-checked; `fsdev run` with it]. With `models` omitted the framework detects providers from environment keys, and a model string like `openai/gpt-6-luna` resolves automatically. `hc/fsdev.config.ts:9-12`. With `stores` omitted the app runs in memory and says so at startup: `[flowstate] active profile: "default" (no \`stores\` set: the app runs in memory, and nothing persists across a restart)`. `eng/flowstate/createFlowState.ts:972`. [page; the route file and stores are S-5 and Persistence: link]
- The route's exports: `export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate); export const dynamic = "force-dynamic";` `hc/app/api/flows/[[...path]]/route.ts:6-8`. `old-qs:129-131` also sets `runtime = "nodejs"`. [page: in S-5]
- Start it with `pnpm dev` (`next dev`) and open the page; the reader sends a message and watches the reply stream in and `Messages sent` go to 1. `hc/package.json:7` (`"dev": "next dev"`). [page; the count was confirmed over the route, section 5; the browser page itself was not driven: **[verify]** the rendered page]
- The figure `first-flow-homes.svg` (published, `apps/docs/docs/getting-started/first-flow-homes.svg`; description at `old-yff` "What just happened") shows three places: browser (`page.tsx`: `FlowProvider`, `useFlow`, `useSession`, `ItemsRenderer`; sees only client-marked items and exposed state), server (`lib/flowstate.ts` and the route: `hello-chat` registered with `chat`, runs the pipeline), store (one session: its state, `messageCount`, and its items). A reload reads the session back from the store. This page's figure 2 is the file layout (section 2), not that drawing; reuse its three-places idea only if the page keeps it as a third figure, which the plan does not list. [page: figure facts; **[decide]** whether the "three places" drawing survives]

## 8. Test it (step 7)

The test, as run under `vitest` against the scaffold [ran: both tests pass; type-checked under `strict`]:

```ts
import { describe, expect, it } from "vitest";
import { mockGenerator, testBlock, testFlow } from "@flow-state-dev/testing";
import helloChat from "../src/flows/hello-chat/flow";
import { countMessage } from "../src/flows/hello-chat/blocks/count-message";

describe("hello-chat", () => {
  it("answers with the scripted reply", async () => {
    const chat = mockGenerator({ name: "chat-generator", script: [{ text: "Hi there!" }] });
    const result = await testFlow({
      flow: helloChat,
      action: "chat",
      userId: "test-user",
      input: { message: "Hello" },
      generators: { "chat-generator": chat },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("Hi there!");
    const reply = result.items.find((item) => item.type === "message" && item.role === "assistant");
    expect(reply).toBeDefined();
  });

  it("adds one to the count", async () => {
    const result = await testBlock(countMessage, {
      input: "any reply",
      session: { state: { messageCount: 3 } },
    });
    expect(result.error).toBeNull();
    expect(result.state.session.messageCount).toBe(4);
  });
});
```

- **What stands in for the model (answers Q4):** a scripted generator from `mockGenerator({ name, script })`. Each call to the generator takes the next script entry; `{ text }` is its reply. It is passed to `testFlow` under `generators`, keyed by the generator block's `name` (`"chat-generator"`). `tst/mocks/mockGenerator.ts:434-437,157-178`; `tst/test-utilities/types.ts:160`; `hc/test/flow.test.ts:40-54`. [page]
- `testFlow({ flow, action, input, userId, generators })` runs one action of the flow through the engine's own run path, in-process, against in-memory stores. No server, no HTTP, no database, no network, no API key. `userId` is required. `tst/test-utilities/testFlow.ts:185-216`; `tst/test-utilities/types.ts:153-160`; `hc/test/flow.test.ts:8-11,57-67` (the example's tests make `fetch` throw to prove it). [page]
- The result: `status` (`"completed" | "failed" | "incomplete" | "interrupted" | "aborted" | "suspended"`), `output` (the action's output; here the reply text), `error`, `items` (what a client would receive). It does not throw when the run fails. `tst/test-utilities/types.ts:191-212`; `tst/test-utilities/testFlow.ts:218-231`. [page: `status`, `output`, `items`]
- `result.items` of the finished flow, in order [ran]: `message:user`, `block_trace:chat-pipeline`, `block_trace:clean-message`, `block_trace:chat-generator`, `message:assistant`, `block_trace:count-message`, `state_change`. An assistant `message` item and a `state_change` item are the two a test asserts on. `tst/test-utilities/testItems.ts:1-60` (`testItems(items).messages()`, `.byType(...)`; exported from the package, `tst/index.ts:9`). [page]
- A `testFlow` result carries no session state. To assert the count, either read the run's `state_change` item (`delta` is the increment for `incState`, the total for `patchState`; section 5) or test the counter alone with `testBlock`. `tst/test-utilities/types.ts:191-212` (no `session`); [ran]. [page]
- `testBlock(block, { input, session: { state } })` runs one block alone. Seed session state with `session: { state: { messageCount: 3 } }`; the result has `output`, `error` (`null` on success), `state.session` (the state after the run) and `stateChanges`. With `session` omitted the counter starts at the schema default: input `"x"` gave `messageCount: 1`. [ran] `tst/test-utilities/testBlock.ts:72-86,145-148`; `tst/test-utilities/types.ts:36-69,93-129`. [page]
- `testFlow` also takes `seed: { session: { state } }` to start a flow run from given state, and `stores` plus `sessionId` to reuse one in-memory store across calls (a second turn). With `stores` and `sessionId` shared, turn 2's mock call carried turn 1's user and assistant messages, and the count read 2. [ran] `tst/test-utilities/types.ts:157-159,181`; `tst/test-utilities/testFlow.ts:185-197`. [ref: the page may show one; the old guide's `seed` example works, only `result.session` does not]
- Failure shapes [ran]; each is `status: "failed"` with `error.message`, not a throw:
  - No mock for the generator: `No mock for generator "chat-generator" / model "openai/gpt-6-luna". Provide generators["chat-generator"] or models["openai/gpt-6-luna"], or set unmockedGeneratorPolicy to "warn", "allow", or "default".` This is also what a mock keyed by the wrong name (`chat`) produces.
  - Script used up: `Mock generator "chat-generator" has no script entry matching the current call. Plain-step queue is exhausted and no predicate matched. Add a plain step, a matching \`{ when, then }\` predicate, or call .reset().`
  - Input the action's schema rejects: `Action input validation failed at "message": String must contain at least 1 character(s)`.
  [page: the first, one sentence; the others [ref]]
- The mock records the calls it received: `chat.calls[0].input` is the message list the model would have been sent (system, then history, then user). A test can assert the model was told what the page claims. [ran] `tst/mocks/mockGenerator.ts:157-165`. [page: optional; it is the test-side counterpart of Q1]
- `hc/test/flow.test.ts` passes both `generators: { "chat-generator": fixture }` and `models: { [MODEL_ID]: fixture }`; the `generators` key alone is enough [ran]. [page: use `generators` only]
- Run with `pnpm vitest run` (the example's script is `vitest run --root .`, `hc/package.json:11`). Install: `pnpm add -D @flow-state-dev/testing vitest`. `apps/docs/docs/testing/testing-flows.md:11-13` (existing page, install line). Testing in depth is C-20; the page links. [page]
- Test location: the example keeps tests in `hc/test/flow.test.ts` and imports the flow with a relative path; the old guide puts them in `src/flows/hello-chat/__tests__/flow.test.ts`. Neither is required by the framework. **[decide]**.

## 9. Where to go next

Links the page may carry, as plan ids and what the reader gets there. Link only; none are explained on this page.

- Blocks, the five kinds and the rules each follows: C-02 (`../concepts/blocks.md`).
- Composition, the rest of the sequencer (parallel, conditional steps, loops): C-04.
- State and scopes, the other three scopes and the exposure rule: C-07.
- The route file and serving: S-5.
- Models and intents: the Models concept page.
- Testing in depth, mocking tools and evals: C-20 (`../concepts/testing.md`).
- Persistence, to keep the count across restarts: the Persistence concept page.
- The CLI, for `fsdev chat` and `fsdev dev`: `apps/docs/docs/cli/overview.md`.

## 10. What the page must not say (limits and traps, from sections 0 to 8)

- Do not show `flows: { chatFlow }` or a `[...path]`-only route (section 0).
- Do not say `result.session.state` exists on a `testFlow` result, or that `generators: { chat: { output } }` works (section 0).
- Do not say a `--session` reuse works across `fsdev run` calls without saying the store must persist (section 5).
- Do not say `incState`'s `state_change` shows the new total (section 5).
- Do not say the framework "deduplicates" the user message unless the page says "when the text is equal" (section 6).
- Do not claim the model sees one message when a step rewrote the text (section 6).
- Do not claim the rendered page was driven in a browser; only the route and the type-check were run (section 7).

## 11. What was run, and how

All runs were against the repository's current source, using a throwaway copy of the tutorial's files under `examples/hello-chat/.scratch/` (removed afterwards; `git status` shows no residue), and the example itself. No file in `apps/`, `packages/` or `examples/` was changed.

- **Scaffold run:** `blocks/chat-generator.ts`, `blocks/clean-message.ts`, `blocks/count-message.ts`, `flow.ts` (the pipeline `cleanMessage`, `chatGenerator`, `.tap(countMessage)`), `fsdev.config.ts` (`createFlowState({ flows: [helloChat] })`), `app/page.tsx`, and the two-test file in section 8. Typechecked with the example's `tsconfig.json` (`strict`): no errors in the scaffold's source, config, page or tests. Both tests passed under `vitest`.
- **`fsdev run`** against the example and the scaffold with a real model: output events, traces, the generator patch, `flow_complete`, `--seed-session`, `-s` reuse with and without a config, `--no-config`, the empty-input failure, the no-key failure with the key variables unset.
- **`testFlow` / `testBlock`:** the run in section 8; the doubled-message run and its equal-text control; the tap-first run; two turns on one session and a third on another; the unmocked, exhausted-script and wrong-key failures.
- **Server:** the example's dev server with `[[...path]]` (`GET /api/flows` 200 with the flow list) and with the directory renamed `[...path]` (404), then restored. The session state snapshot over the router, in process, after one action: `clientData: { session: { messageCount: 1 } }`.
- **Not run:** a browser against the page; a handler that throws; the single-declaration form of `expose` (section 5); option (B) and (C) in section 6.

## 13. Revise round 3

- Page step 7 now states the wrong-key result in one sentence: the key is the generator block's `name`, not the action's; a key that matches no generator returns `status: "failed"` with `error.message` beginning `No mock for generator "chat-generator"`, and `testFlow` does not throw. Source: section 8, failure shapes (first bullet) and the result line. This supersedes the section 12 note that the page no longer states it; the full message text stays a Testing reference row.

## 12. Revise round 1

- Page step 1 says Node 22.3 (section 0, Node row). Step 4's run before step 5's flow declaration is [ran] (section 5).
- A mock keyed by the wrong name (`chat`) fails with `No mock for generator "chat-generator" ...`: the text names the generator block that went unmatched, not the key typed. [ran, revise round 1] The page no longer states it; it is a Testing reference row.
- Moved to Reference, the page keeping a link: `itemVisibility` flags and the no-flag result (items, R-06); `fsdev run` output format, flags and default user (CLI, R-35); what a run streams and the no-key error text (items, R-06); default store per entry point (runtime, R-12); `patchState` against `incState` deltas (state operations, R-07); the optional catch-all route (HTTP API, R-13); `testFlow` failure shape and result fields (generated testing page, no R-id). Facts in sections 3 to 8 that the page no longer states stay here as source for those rows.
- Step 3 keeps one filter (`flow_complete`, `.output`) and `--quiet`; step 5 uses `--quiet` and an `item_done` filter on `state_change`, so `--quiet` stays unexplained on the page by design (it is a CLI row).
- The page says `devuser` in `FlowProvider` is a stand-in; the default CLI user is a CLI row.
