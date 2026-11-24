# Fact sheet: Build with your coding agent

Page: S-4, `start/build-with-your-coding-agent`, type `start`, 700 words. Pass 1 of the ten passes.

Sources are only what a fact sheet may cite (`docs/contributing/user-docs.md` → "What a fact sheet may cite"): existing user docs, the exported surface and doc comments, tests, `goals/`, and examples. Every claim marked "observed" was also run in this checkout on 2026-11-15 with `npx tsx packages/fsdev/bin/fsdev.ts` against the fixtures in `packages/fsdev/test/fixtures/`. Paths are relative to the repo root. `CLI` below means `packages/fsdev`.

**Page job.** Set up a coding agent so it can write a flow, run it, read what happened and fix it.

---

## 1. What the agent runs, and that it needs no server or browser

Answers question 1 and question 4.

| # | Fact | Source |
|---|------|--------|
| 1.1 | `fsdev run <flow> <action>` executes one action of a flow and writes one JSON event per line (NDJSON) to stdout. | `CLI/src/commands/run.ts:2`, `:130-133`; `apps/docs/docs/cli/overview.md:15`, `:40` |
| 1.2 | `run`, `block` and `chat` call the engine in-process: no HTTP server and no SSE. | `apps/docs/docs/cli/overview.md:26`; `apps/docs/docs/cli/agent-dev-loop.md:8` |
| 1.3 | "No browser, no HTTP server, no mock harness." The CLI runs the same `runAction` the production server uses, against the same stores. Code calls `runAction({ flow, actionName, input, userId, orgId, sessionId, stores, responseEmitter, runtimeConfig })`. | `apps/docs/docs/cli/agent-dev-loop.md:8`; `CLI/src/commands/run.ts:532-542` |
| 1.4 | In-process is the Flow State transport only. A generator still calls its model provider over the network and needs that provider's key. A flow made only of handlers needs no key (follows from 1.2; not stated in the docs, so say only the first part flat). | `apps/docs/docs/cli/overview.md:26` |
| 1.5 | The CLI loads `.env.local` before it imports the app's config, so generator providers see the gateway and API keys. `--dotenv <path>` loads a specific `.env` file, repeatable. | `CLI/README.md:426`; `CLI/src/commands/run.ts:142` |
| 1.6 | The two output channels are separate. Stdout is NDJSON only (test: no stdout line starts with `[flow-state]`, every line parses as JSON). Stderr carries runtime logs that start `[flow-state] `, one JSON object of context after the message. | `CLI/test/run-command.integration.test.ts:398-410`; `CLI/src/resolve-runtime.ts:230-237` |
| 1.7 | The stderr logger writes `<message> <json>` per line; context values over 240 characters are cut with `…`. | `CLI/src/resolve-runtime.ts:185-200`, `:233-237` |
| 1.8 | Before the run, stderr prints one line naming who it runs as, unless `--quiet`. Observed: `[fsdev] running as devuser in organization __fsd_default_org__ (no resolver configured)`. | `CLI/src/commands/run.ts:413`; observed |
| 1.9 | Run it from the app's directory. With an `fsdev.config.ts` there, `fsdev run` uses the app's models, stores and flow registry instead of CLI defaults. Config search is cwd-only. | `apps/docs/docs/cli/agent-dev-loop.md:33`; `apps/docs/docs/cli/overview.md:54`; `CLI/src/commands/run.ts:273-301` |
| 1.10 | With no config, flows are found by directory discovery: `src/flows/`, `flows/`, and in a monorepo one level under `packages/`, `examples/`, `apps/`, `labs/`. `--flow-dir <path>` (repeatable) restricts it. `--flow-dir` together with a config is refused. | `apps/docs/docs/cli/overview.md:50`; `CLI/src/commands/run.ts:141`, `:276`; test `CLI/test/run-command.integration.test.ts:745` |
| 1.11 | `--model <id>` replaces the model for every generator that runs in the command's process (e.g. `openai/gpt-6-luna`). With a config it wraps the app's resolver. | `apps/docs/docs/cli/overview.md:58-60`; `CLI/src/commands/run.ts:474-484` |

The exact starting command in the S-1 draft is `pnpm fsdev run hello-chat chat -i '{"message": "Hello!"}'`, and `examples/hello-chat/fsdev.config.ts:6-7` shows the same command and registers `hello-chat` (one action, `chat`: `examples/hello-chat/src/flows/hello-chat/flow.ts:75-79`, with the action name per its header comment).

## 2. What the agent reads back

Answers question 1 (what it reads) and question 3 (the failed step).

### 2a. The event types on stdout

| # | Fact | Source |
|---|------|--------|
| 2.1 | The stdout event types are `item_added`, `item_updated`, `item_done`, `content_delta`, `state_change`, `flow_complete`, `suspended` and `error`. | `CLI/src/commands/run.ts:56-64` |
| 2.2 | `item_added` and `item_done` carry a whole `item`. `item_updated` carries `itemId` and a `patch`. `content_delta` carries `itemId` and a `delta` string. `state_change` carries `scope`, `resourcePath`, `changeType`. | `CLI/src/commands/run.ts:56-61`, `:693-737` |
| 2.3 | A run ends with exactly one terminal event: `flow_complete` `{ output, durationMs, items }` on success, `suspended` when the run is held for a person, or `error` `{ message }` on failure. Observed on the echo fixture: `{"type":"flow_complete","output":{"reply":"Echo: hi","source":"echo-flow"},"durationMs":89,"items":1}`. | `CLI/src/commands/run.ts:568-583`; observed |
| 2.4 | The `error` event carries only `message` on stdout (no `code`, no step name). | `CLI/src/commands/run.ts:580-583`; observed |
| 2.5 | `item_updated` and `item_done` events exist and describe a lifecycle: the item is added, patched, then done carrying the finalized item. | `CLI/test/run-command.integration.test.ts:480-514` |
| 2.6 | The assistant's message text is the concatenation of `content_delta` deltas. | `apps/docs/docs/cli/agent-dev-loop.md:46-47`; `CLI/src/commands/run.ts:720-727` |
| 2.7 | Item shapes are Reference. The Start page links to `reference/items` and does not describe them. | Sitemap row: "Links to, does not explain" (page plan, from the brief) |

### 2b. A step that did the work: `block_trace`

| # | Fact | Source |
|---|------|--------|
| 2.8 | Every block that runs emits a `block_trace` item on stdout: `blockName`, `blockKind`, `status` (`in_progress`, then `completed` or `failed`), `input`, `output`, `startedAt`, `completedAt`, `duration`. It is added, patched by `item_updated`, and finished by `item_done`. Observed: a handler named `echo-handler` gives `item_added` (in_progress), `item_updated` with `"status":"completed"` and `"output":{"kind":"inline","value":{"reply":"Echo: hi",...}}`, then `item_done`. | `apps/docs/docs/streaming/items.md:57-108`; observed |
| 2.9 | A model-calling block's `block_trace` also carries the generator's `model`, `messages`, `temperature` (patched in) and `modelUsage` token counts at the end. | `apps/docs/docs/streaming/items.md:74-107` |
| 2.10 | A `tool_output` item is added before a tool runs and patched when it returns; it carries `toolCall.name` and `toolCall.arguments`. The existing page's worked example reads one `tool_output` per tool call with `jq -c '.events[] | select(.type=="item_added" and .item.type=="tool_output")'` on a capture file. | `apps/docs/docs/streaming/items.md:114-141`; `apps/docs/docs/cli/agent-dev-loop.md:29-30` |

### 2c. The failed step (question 3)

Observed by running `fsdev run throwing fail -i '{"message":"x"}' --flow-dir packages/fsdev/test/fixtures/flows` (fixture `CLI/test/fixtures/flows/throwing-flow/flow.ts`, a handler named `throwing-handler` that throws `Intentional test error from flow`).

| # | Fact | Source |
|---|------|--------|
| 2.11 | On stdout the failed block's `block_trace` ends with `"status":"failed"` and `"error":{"message":"Intentional test error from flow","code":"execution_error"}`, with `blockName: "throwing-handler"` and `blockKind: "handler"` on the item. This is the step that failed. | observed; `apps/docs/docs/streaming/items.md:112` ("When a block fails, `block_trace.error` is `{ message, code?, details? }`") |
| 2.12 | A top-level `item` of `type: "error"` follows (`message`, `code`, `provenance.blockName: "runtime"`), then the terminal `{"type":"error","message":"..."}` line. | observed |
| 2.13 | On stderr, a line `[flow-state] block execution failed {...}` names `blockName`, `blockKind`, `blockInstanceId`, `attempt`, `durationMs`, and `error` (e.g. `"FlowError: Intentional test error from flow"`). It is followed by `[flow-state] action execution failed {...}`. The success path logs `[flow-state] action execution started` and `[flow-state] action execution completed`. | observed; `CLI/test/run-command.integration.test.ts:385-396` |
| 2.14 | For a generator whose output fails its schema, `block_trace.error.details` carries `rawOutput` (what the model returned), `issues` (the Zod issues) and `phase` (`"stream"` or `"final"`). Author-thrown `FlowError.details` pass through. | `apps/docs/docs/streaming/items.md:112` |
| 2.15 | `--log-level debug` adds nested-block events, for tracing inside sequencers and routers. Not run here; nested-block output not observed. | `apps/docs/docs/cli/agent-dev-loop.md:50` |
| 2.16 | `--log-level` accepts `debug`, `info`, `warn`, `error`; default `info`. Any other value is refused with exit code 2 (`Invalid --log-level`). | `CLI/src/resolve-runtime.ts:252-268`; `CLI/test/run-command.integration.test.ts:435-445` |
| 2.17 | `--quiet` silences stderr runtime logs (and the `[fsdev] running as` line). Under `--quiet` the failed step is read from the stdout `block_trace`, since the stderr line is gone. | `CLI/src/commands/run.ts:145`, `:413`; `CLI/test/run-command.integration.test.ts:412-421`; `apps/docs/docs/cli/agent-dev-loop.md:50` |

### 2d. Exit codes and how the agent knows it passed

| # | Fact | Source |
|---|------|--------|
| 2.18 | `fsdev run` exits 0 on success, 1 on an execution error, 2 on invalid input (unknown action, bad `--log-level`, bad seed JSON, a session that belongs to another flow or user), 3 on a config error, 4 when the flow is not found, 10 for an unexpected error. Observed exit 1 for the throwing flow. | `CLI/src/exit-codes.ts:1-20`; `CLI/src/commands/run.ts:601`; `CLI/test/run-command.integration.test.ts:334-382`; observed |
| 2.19 | An unknown flow lists the available flows; an unknown action lists the available actions. | `CLI/src/commands/run.ts:290-294`, `:349-356`; tests `:193-223` |
| 2.20 | A flow module that fails to import prints a warning on stderr and is named in the "not found" error, so a broken flow is distinguishable from a missing one. | `apps/docs/docs/cli/overview.md:52` |
| 2.21 | A run that stops for a person exits 0, emits a `suspended` event on stdout (with `suspensionId`, `requestId`, `sessionId`, `reason`, and an `answer` sentence saying where to answer), and answers through `fsdev dev` on the same store. The agent should treat `suspended` as "not done". | `CLI/src/commands/run.ts:63-80`, `:566-571`; `CLI/README.md:117-119` |
| 2.22 | `flow_complete` can appear while background work the flow started is still running; the process stays up until that work ends (bounded by `dispatchDrainTimeoutMs`, default 30 s). A run that has printed `flow_complete` and not returned is usually waiting on it. With a queueing adapter the command returns without waiting. Without a config, background work cannot start. | `apps/docs/docs/cli/agent-dev-loop.md:52`; `apps/docs/docs/cli/overview.md:78-129` |

### 2e. `--capture`: one file to diff or read

| # | Fact | Source |
|---|------|--------|
| 2.23 | `--capture <path>` writes the whole run to one JSON file and is additive: stdout still streams. Parent directories are created. | `CLI/src/commands/run.ts:147`, `:210-219`; tests `CLI/test/run-command.integration.test.ts:533-562` |
| 2.24 | The capture file is `{ command, events, result }`. `command` holds `flow`, `action`, `input`, `model`, `session`, `seedSession`, `principal`. `events` is every stdout event, in order. `result` is `{ success, flow, output, execution: { durationMs, itemCount }, error?, suspended?, exitCode }`. | `CLI/src/commands/run.ts:195-208`, `:603-619` |
| 2.25 | A failed run's capture has `result.success: false`, `result.exitCode: 1`, and an `error` event in `events`. | `CLI/test/run-command.integration.test.ts:516-531` |
| 2.26 | `jq` recipes the existing page gives: final result `select(.type=="flow_complete")`; errors `select(.type=="error")`; text `select(.type=="content_delta") | .delta`, each run with `2>/dev/null` to drop stderr. | `apps/docs/docs/cli/agent-dev-loop.md:39-48` |

Note: the existing page's capture recipe reads `.events[]` from the capture file (`agent-dev-loop.md:30`), and `item_added` events only exist for the item in progress. To find the failed step in a capture the agent filters `item_done` events where `.item.type=="block_trace" and .item.status=="failed"`. Observed shape of that event matches 2.11.

## 3. Run one block alone

| # | Fact | Source |
|---|------|--------|
| 3.1 | `fsdev block <file>` runs one block through the test harness. The argument is a file path, absolute or relative to the working directory. | `CLI/src/commands/block.ts:56-57`; `CLI/src/resolve-block.ts:46-54` |
| 3.2 | The file must default-export a block (`export default planQueries;`). A missing file exits 4 (`Block file not found`); no default export exits 4; a default export that is not a block (needs `kind`, `name`, `run`) exits 4. The layout in `user-docs.md` names blocks with a named export, one per file, so a page example that is to be run with `fsdev block` needs `export default` as well. | `CLI/src/resolve-block.ts:56-81`; `CLI/test/fixtures/throwing-block.ts:1-12` |
| 3.3 | Input is `-i, --input <json>` or `-f, --input-file <path>`. `-m, --model <model>` sets a model; `--format` defaults to `json`. | `CLI/src/commands/block.ts:58-61` |
| 3.4 | The block runs alone: no flow context, no session. It runs under the user `cli-user`. | `apps/docs/docs/cli/overview.md:46`; `CLI/src/commands/block.ts:101-103` |
| 3.5 | Output is one JSON document on stdout: `{ success, block: { kind, name }, output, schemaValidation: { input: { passed, errors? }, output: { passed, errors? } }, execution: { durationMs }, error?: { message, stack? } }`. | `CLI/src/commands/block.ts:14-32`, `:136-154` |
| 3.6 | Exit 0 on success, 1 on failure. Observed on a block that throws: `"success": false`, `"error": { "message": "Intentional test error" ...}`, exit 1. | `CLI/src/commands/block.ts:155`; observed |
| 3.7 | A bad input is reported without a run being skipped: the input is checked against the block's `inputSchema` and the result is in `schemaValidation.input` (`passed: false`, `errors: ["Required", ...]`); the block then fails with `Block "<name>" input validation failed at "<field>": Required`. Observed with `schema-block.ts`. | `CLI/src/commands/block.ts:97-98`, `:34-51`; observed |
| 3.8 | `--model` makes unmocked generator blocks call real providers. Without it, what a generator block does under `fsdev block` was not observed here; a handler block is the verified case. | `CLI/src/commands/block.ts:105-109` |
| 3.9 | Use it for handler logic or generator output "without wiring up a full flow". | `apps/docs/docs/cli/overview.md:33`, `:46` |

## 4. The loop, in the order the agent does it

| # | Fact | Source |
|---|------|--------|
| 4.1 | The documented loop is four steps: edit, run `fsdev run`, read (stderr logs, stdout NDJSON), repeat. The figure's four steps (write, run, read the events, fix) are the same loop with edit split into write and fix. | `apps/docs/docs/cli/agent-dev-loop.md:10-15` |
| 4.2 | Flags the loop uses: `-i` inline input, `-f` input file, `-s` session, `--seed-session` pre-populates session state (inline JSON or a path), `-m` model, `--flow-dir`, `--capture`, `--quiet`, `--log-level`. Every flag is `reference/cli`'s, not this page's. Also present on `run`: `--org`, `-u/--user`, `--dotenv`, `--config`, `--no-config`, `--store`. | `CLI/src/commands/run.ts:134-148`; `apps/docs/docs/cli/agent-dev-loop.md:54-66` |
| 4.3 | `--session <id>` continues a session: state from the previous run is loaded, which is how an agent exercises a multi-turn flow. A session that belongs to another flow or to another user is refused (exit 2, "nothing was written"). | `apps/docs/docs/cli/overview.md:42`; `CLI/src/commands/run.ts:383-392`; test `CLI/test/run-command.integration.test.ts:154-180` |
| 4.4 | `--seed-session` merges the given fields into session state before the run. Session is the only scope that can be seeded. Seeding a server-owned field is refused. | `apps/docs/docs/cli/overview.md:74-76`; `CLI/src/commands/run.ts:374-377`, `:416-422`; tests `:564-604`, `:671` |
| 4.5 | Verifying a flow change is `fsdev run`. It is not the tool for: pure helpers, types or schemas (use `pnpm test`; Vitest asserts values directly), component rendering, streaming display or hydration (needs a browser: "NDJSON tells you the data is right; only a browser tells you the render is right"), or a live multi-turn conversation by hand (`fsdev chat`). Testing is C-20; this page links and does not explain it. | `apps/docs/docs/cli/agent-dev-loop.md:68-77` |
| 4.6 | So: the loop does not need a browser or a running server for a flow's logic. A browser is needed to check how a UI renders. | `apps/docs/docs/cli/agent-dev-loop.md:73`; 1.2 |
| 4.7 | The loop closes with no person in it: nothing in `fsdev run` prompts. The exception is a flow that suspends for a person (2.21), which exits 0 with a `suspended` event. | `CLI/src/commands/run.ts:566-571` |

## 5. Give the agent the docs

Question 2, first half.

| # | Fact | Source |
|---|------|--------|
| 5.1 | The docs site serves `/llms.txt`, built from the same pages as the site: `https://flow-state.dev/llms.txt`. | `apps/docs/scripts/agent-docs/plugin.mjs:30-31`, `:52`; `apps/docs/docusaurus.config.ts:35-36` |
| 5.2 | `llms.txt` follows the llmstxt.org layout: the site title (`flow-state.dev`), the tagline as a one-line summary ("Composable AI workflows for TypeScript. Blocks in. Streaming out."), then one list per top-level sidebar section. Each entry is `- [Title](<origin>/<page>.md): description`. | `apps/docs/scripts/agent-docs/index-files.mjs:41-50`; `apps/docs/docusaurus.config.ts:31-32`; test `apps/docs/scripts/agent-docs/agent-docs.test.mjs:138-158` |
| 5.3 | Every docs page is also served as Markdown at its URL plus `.md` (`/docs/intro` is `/docs/intro.md`); a URL ending in `/` takes `index.md`. The `.md` files are written at build time beside the HTML, so any static host serves them. | `apps/docs/scripts/agent-docs/index-files.mjs:4-15`; `apps/docs/scripts/agent-docs/plugin.mjs:2-3`, `:51`; test `agent-docs.test.mjs:130-133` |
| 5.4 | Links between pages in those Markdown files point at each other's `.md` URL. | `apps/docs/scripts/agent-docs/plugin.mjs:67-78`; test `agent-docs.test.mjs:119-128` |
| 5.5 | `/llms-full.txt` (the Markdown of named sections in one file) is written only when the plugin option `full` names a section. It is set to `[]` today, so the file does not exist yet. The page should point at `llms.txt` and not at `llms-full.txt`; mark any mention for reconciling at cutover. | `apps/docs/docusaurus.config.ts:178-182`; `apps/docs/scripts/agent-docs/index-files.mjs:52-61`; test `agent-docs.test.mjs:161-170` |
| 5.6 | The site sets `url: "https://flow-state.dev"`, `baseUrl: "/"`. | `apps/docs/docusaurus.config.ts:35-36` |
| 5.7 | Not verified: the URL as served from a live deploy (no network call made). Verified in code and in the plugin tests only. | n/a |

Do not carry the issue number the sitemap row puts beside the `llms.txt` example into the page.

## 6. Give the agent the skills

Question 2, second half. Evidence is thin; this section is mostly what cannot be stated.

| # | Fact | Source |
|---|------|--------|
| 6.1 | A skill is a Markdown file a coding agent loads when a task calls for it. In this repo the skills are `SKILL.md` files under `.agents/skills/<name>/`, with `name` and `description` frontmatter. | `.agents/skills/debug-flow/SKILL.md:1-5`; `plugins/flow-state-dev/skills/install-fsd/SKILL.md:1-4` |
| 6.2 | `debug-flow` is "the fsdev-run toolkit": NDJSON traces, stderr logs, `fsdev block` isolation, and a failure-pattern table. `diagnose` is the bug loop that calls it. The existing CLI page names both ("switch into `diagnose`... uses the `debug-flow` toolkit (failure-pattern matrix and `fsdev block` isolation)"). | `.agents/skills/debug-flow/SKILL.md:1-5`; `apps/docs/docs/cli/agent-dev-loop.md:74` |
| 6.3 | Other skills in `.agents/skills/` for writing FSD code: `create-block`, `add-flow`, `tdd`, `write-block-tests`, `create-pattern`. They live in this monorepo for its contributors. Whether they ship to a user's project is not observable in the code. | directory listing `.agents/skills/` |
| 6.4 | The one skill a user installs today is `install-fsd`, in the `flow-state-dev` plugin (`plugins/flow-state-dev/skills/install-fsd`). It wires FSD into an existing Next.js or Node project, writes only files on an allowlist (a config, `flows/hello/flow.mts`, a route mount, `.gitignore`, `.env.local`, `AGENTS.md`), and never commits. It is run by a coding assistant from the project directory. | `plugins/flow-state-dev/skills/install-fsd/SKILL.md:1-60`, `:73`; `apps/docs/docs/getting-started/existing-project.md:15` |
| 6.5 | `install-fsd` appends a delimited section to `AGENTS.md` (`<!-- flow-state-dev:start -->` ... `<!-- flow-state-dev:end -->`), created if absent, replaced between its own delimiters on a second run. The body between the delimiters is a placeholder (`{{AGENT_INSTRUCTIONS}}`), so the section has no instruction text today. | `plugins/flow-state-dev/skills/install-fsd/SKILL.md:120-128` |
| 6.6 | The skill's closing message says "AGENTS.md now tells your coding assistant how to write FSD flows here." `AGENTS.md` is optional for a developer without a coding assistant. | `plugins/flow-state-dev/skills/install-fsd/SKILL.md:276`; `apps/docs/docs/getting-started/existing-project.md:255` |
| 6.7 | The skills in `packages/orchestration/src/skills` and `goals/**/skills` are a different thing: playbooks a worker loads. `install-fsd` is stated to have nothing to do with them. | `README.md:101` |
| 6.8 | From the brief only, not observable: the starters ship a skills pack and an agent-instructions file once starters install outside the monorepo; until then the page "names the skills and where they will be". No starter in the repo contains either today (no `AGENTS.md` or `skills/` in `examples/hello-chat`, `labs/teammates`). Treat as unverified, and mark for reconciling at cutover. | brief; directory listing |

Suggested honest framing for this section: name `debug-flow` and `diagnose` as what teaches the loop and `install-fsd` as what writes `AGENTS.md`; say the starter-bundled pack is not in the starters yet. The writer decides. The sheet does not say which skills the pack will hold.

## 7. A prompt to try, and the diff it should produce

The scenario must belong to the one made-up app (the research flow). Facts the prompt and diff can rest on, all from public surface:

| # | Fact | Source |
|---|------|--------|
| 7.1 | The app layout: `src/flows/<flow>/flow.ts`, `src/flows/<flow>/blocks/<block>.ts` (one block per file), `src/flows/<flow>/tools/<tool>.ts` (a block a model calls as a tool). | `docs/contributing/user-docs.md:290-300` |
| 7.2 | The S-1 draft's research example: `src/flows/research/blocks/assistant.ts` imports `generator`, `sequencer` from `@flow-state-dev/core`, and `planQueries`, `runSearches`, `summarize` from `./plan-queries`, `./run-searches`, `./summarize`; the `assistant` generator is `model: "openai/gpt-6-luna"` with `tools: [research]`. | `docs/contributing/docs-revamp/pages/start/what-flow-state-is.md:64-91` |
| 7.3 | A flow is declared with `defineFlow({ kind, actions: { <name>: <block> } })` and the call result is registered: `const flow = defineFlow({...})(); export default flow;`. An action is a block; a handler needs `name`, `inputSchema`, `outputSchema`, `execute`. | `CLI/test/fixtures/flows/echo-flow/flow.ts:1-27`; `examples/hello-chat/src/flows/hello-chat/flow.ts:75-79` |
| 7.4 | A handler is `handler({ name, inputSchema: z.object(...), outputSchema, execute: async (input) => ... })` imported from `@flow-state-dev/core`; `zod` for schemas. | `CLI/test/fixtures/throwing-block.ts:1-12`; `CLI/test/fixtures/flows/echo-flow/flow.ts:5-14` |
| 7.5 | A flow in the app is registered in `fsdev.config.ts` as `createFlowState({ flows: [helloChatFlow] })`, default export, from `@flow-state-dev/engine`. | `examples/hello-chat/fsdev.config.ts:15-21` |
| 7.6 | A failing handler's message appears on the failed `block_trace.error.message`, so a prompt like "run it with `fsdev run`, read the events, and fix what fails" has a concrete thing to read back (2.11). | observed |
| 7.7 | Nothing here has been type-checked as a page example; the writer's code must be checked against `@flow-state-dev/core` (pass 4). The `fsdev block` example needs `export default` (3.2). | `docs/contributing/user-docs.md:319-321` |

## 8. Stored parts (four questions)

The page is about a workflow, not a stored thing, but each run writes a session and a request record. The sheet answers the four questions for the one stored part a reader meets in the loop: the session `fsdev run` writes.

| Question | Answer | Source |
|----------|--------|--------|
| Who owns it | The run's principal. With no `--user` and no resolver it is `devuser` in the default org; `-u/--user` and `--org` override; with a config, the app's resolver chooses. A session belongs to one flow and one user and another user's or flow's session is refused. | `CLI/src/commands/run.ts:139`, `:383-392`; observed `[fsdev] running as devuser ...` |
| Who can see it | A server on the same store: `fsdev dev` reads the file `fsdev run` writes, so the DevTool lists the session after the run. A run's writes do not push to pages `fsdev dev` already has open. | `CLI/src/local-store.ts:5-10`, `:31-34` |
| Where it is stored | With no config: `.fsdev/data/fsdev.db` (SQLite) in the working directory by default, or JSON files under `.fsdev/data` with `--store filesystem` (single-process; run and dev cannot use it at the same time). With a config: the config's own stores. The seam `--capture` writes is a separate JSON file wherever the path says. | `CLI/src/local-store.ts:26-34`; `CLI/src/commands/run.ts:310-340` |
| How many | One new session per run unless `--session <id>` names one to continue. The id defaults to `sess_<timestamp>_<random>`. So an agent that runs a flow ten times without `--session` leaves ten sessions. | `CLI/src/commands/run.ts:373` |

## 9. What the page cannot say, and what it links to

- Limits (state flat, from the sources above): the loop checks a flow's logic, not its rendering (4.5). It does not authenticate; the CLI runs in-process as a local trusted path (`plugins/flow-state-dev/skills/install-fsd/SKILL.md:265-266` ends "fsdev run never authenticates"). The generator still needs a provider key (1.4).
- Does not explain: every CLI flag (`reference/cli`), event shapes (`reference/items`), testing (C-20), stores, sessions, background work.
- Existing pages the page rewrites from: `apps/docs/docs/cli/agent-dev-loop.md`, `apps/docs/docs/cli/overview.md`. Drop from the rewrite: the monorepo-only path `apps/kitchen-sink`, the `chat-agent` kitchen-sink flow, `pnpm fsdev` from `apps/kitchen-sink`, and the link to `diagnose` as a contributor skill unless 6.2 survives.

## 10. Things for the writer to watch

- **Contradiction on the page being replaced.** `agent-dev-loop.md:14` says stderr shows "the shape of execution" and stdout streams only `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`. Observed stdout also carries `item_updated`, `item_done`, `suspended`, and the trace items (`block_trace`, `error`). The failed step is on stdout in the `block_trace`, not only on stderr. Use the observed list.
- **`agent-dev-loop.md:30` filters `item_added` for `tool_output` on a capture.** Works for the item's first event; a tool's result arrives on `item_updated`/`item_done` (`streaming/items.md:114-141`).
- **Model default noise.** Observed runs in this sandbox also print `[flow-state-dev] ... FSDEV_...` lines to stderr from environment variables set here. They are not part of the product's output; leave them out of any shown transcript.
- **The ring in the figure** (write, run, read the events, fix) matches 4.1; "the loop closes without a person in it" matches 4.7.
- **Brief-only items, not checked against code:** the "Unsettled" note on the skills pack (6.8), and the plan's pointer to a tracker id for the `llms.txt` example (do not print it).

## Revise round 1 notes

- Corrected: the page says each block leaves a `block_trace` item (not event); on stdout it arrives in `item_added`, `item_updated` and `item_done` events (2.8). The item also carries `blockName`, `blockKind`, `blockInstanceId`; `status` is `in_progress`, `completed`, `failed` or `planned`.
- Moved to Reference, page keeps a link (no reference pages exist in the revamp tree yet, so these are listed for whoever writes them): `fsdev run` output contract (stdout events, stderr logs, one terminal event, exit 0/1) and the in-process-on-production-engine wording is cut (1.2, 1.3, 1.6, 2.3, 2.18) -> R-35; `.env.local` and provider key lookup (1.5) -> R-15; `block_trace` fields and failed-trace shape (2.8, 2.11) -> R-06; `fsdev block` arguments, output document and default-export rule (3.1-3.5) -> R-35; `suspended` exit 0, 30 s background wait (2.22), `--log-level debug` (2.15) and `--capture` (2.23, 2.24) -> R-35. The page keeps the `suspended` sentence and the default-export sentence.
- Cut: the starters-will-carry-a-pack roadmap sentences (6.8); the reconcile comment stays.
- Skills (6.1-6.4): the page tells the reader to copy a skill folder from `.agents/skills/` into their agent's skills folder (a skill is a `SKILL.md` folder, 6.1). No installer for these exists in the repo. `install-fsd` is linked to Add to an existing app (6.4).
- Link targets `../reference/cli.md`, `../reference/items.md` and `../reference/environment.md` are not in the revamp tree yet; not build-checked.

## Revise round 2 notes

- Verified by running a two-step sequencer (`planQueries` returning `{ query }`, then `dedupe-queries` with `inputSchema` `{ queries: string[] }`): the handler's failed `block_trace` reads `{"message":"Block \"dedupe-queries\" input validation failed at \"queries\": Required","code":"execution_error"}`. The input schema check runs before `execute`, so the old "input.queries is not iterable" message could not come from the shown block. The enclosing sequencer's trace fails with the same error, so the page's `jq` adds `blockKind=="handler"` to print one line. Message text is Zod 3's ("Required").
- `blocks/assistant.ts` is correct: the `research` sequencer lives in the same file as the `assistant` generator (7.2).
- Moved the `.env.local` note into the "Why the loop works" first paragraph as a prerequisite.
