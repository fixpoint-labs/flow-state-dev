# Facts for Run a starter (S-2, start)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (the Teammates starter). No spec, issue, changeset or `docs/internal` was read. The starter is built (it is `labs/teammates`), so no fact here is a spec's name marked for reconciling. The install command and the final screens are still unsettled (see flags 1 and 8).

Paths are from the repo root. Abbreviations:

- `rd` = `README.md` (root; the existing "Starters" and "Run a starter" sections, the source the page merges and rewrites)
- `tr` = `labs/teammates/README.md`
- `th` = `labs/teammates/host.mts`
- `tc` = `labs/teammates/fsdev.config.mts`
- `tp` = `labs/teammates/package.json`
- `tw` = `labs/teammates/workforce/teams/teammates`
- `dev` = `packages/fsdev/src/commands/dev.ts`
- `env` = `packages/fsdev/src/load-env.ts`
- `gs` = `apps/docs/docs/getting-started/` (`installation.md`, `quick-start.md`, `setting-up-models.md`)
- `cm` = `packages/core/src/models/createModelResolver.ts`
- `wc` = `packages/workforce/src/workers/client.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/environment`, `reference/models`, `reference/worker-md`); the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the sitemap entry and the sources (read first)

1. **The install command is a clone, not an install (O2).** Today there is no `npm`/`pnpm add` route to a starter. "The starters run from a clone of this repository. They are workspace packages that depend on the framework's source, not something you install from npm." `rd:28`. The route is `git clone`, `cd`, `pnpm install`, `pnpm build:assets`, then `pnpm --filter @flow-state-dev/teammates dev`. `rd:34-43`. The page's "Get the starter" step states this and nothing about a future command. The `workforce-starter` registry item (`fsdev ui add workforce-starter`, `packages/ui/registry.json:766-786`) copies one team and one worker into an app; it is not the Teammates starter and has no pages. [verify] whether the page mentions it at all; it fits "Make it yours" or a catalog page, not this one.
2. **The sitemap says `.env`; the loader reads `.env.local`.** `fsdev dev` loads `.env.local` from the current directory and every parent up to the filesystem root, and never overwrites a variable already in the shell. `env:1-16`, `env:22`, `env:81-104`, `packages/fsdev/src/resolve-runtime.ts:112`. A file called `.env` is not read by this loader. The root README says "in a `.env.local` at the repository root". `rd:47`. The page's example is a `.env.local` at the repository root. [page]
3. **Two existing docs disagree on which key works.** `tr:220` says "The model needs a credential the gateway takes (`AI_GATEWAY_API_KEY`)". `rd:51` says `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY` works as is. The code agrees with `rd:51`, not `tr:220`: the starter's default model is `openai/gpt-6-luna` (`tc:52`), a model string with no gateway named, and a string like that is served by the provider's own package with its own key, or else by a gateway. `gs/setting-up-models.md:23` ("Direct keys take priority over gateways when both exist for the same provider"), `cm:1224-1231` (the refusal names all three remedies), `packages/core/test/models/create-model-resolver-intents.test.ts:285`. `@ai-sdk/openai` is a dev dependency of `core` (`packages/core/package.json:204`), which is why an OpenAI key needs no install in a clone. Whether `ANTHROPIC_API_KEY` alone is enough needs one more step (see fact 3.4). The page follows `rd:51`. `tr:220` needs correcting in its own README where it is republished.
4. **Teammates' helper calls always use an OpenAI model, whatever `TEAMMATES_MODEL` says.** `th:80-81` (`UTILITY_MODEL = "openai/gpt-6-luna"`), `th:410-411` (`intents: { utility: [UTILITY_MODEL] }`), `rd:51` ("Teammates' helper calls always use one"). So with only an Anthropic key, the main model can be changed but the helper still wants an OpenAI key or the gateway. The page tells the reader to use `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY`, and sends other providers to Reference. [page one clause; the rest [ref]]
5. **The pnpm version disagrees.** `rd:32` says pnpm 10.4.1 (`corepack prepare pnpm@10.4.1`). The root `package.json:5` says `"packageManager": "pnpm@12.18.0"`. `pnpm-workspace.yaml` carries a comment "pnpm 11+ no longer reads the `pnpm` field in package.json". [verify] which one the page states. The Node floor is `>=22` in `packages/fsdev/package.json:57-59`; the root README says 22.18. Use the README's wording only after the owner settles pnpm; the page can say "Node.js 22 or newer and pnpm" and link the repository README for versions. Nothing here is a Reference fact; it belongs on the page's first section.
6. **The lab's README and the sitemap call the first worker "Lead". The file calls it "Chief of Staff".** `tw/workers/chief-of-staff/WORKER.md:2` (`name: Chief of Staff`). The page shows the list as `Chief of Staff`, `researcher`, `writer`. `tr:12`, `tr:24` and `labs/teammates/test/failed-turn.test.tsx` (the id `teammates.chief-of-staff`) show the id. The page names the worker the reader sees, and `tr` needs the rename carried through where it is republished. Also `rd:23` says "Lead, researcher and writer". [page: use "Chief of Staff"]
7. **`tr:178` says the three file workers "can't be edited or fired". The code and a goal say an edit is allowed.** An edit makes the user's own copy under the same id, and a reset puts the file's version back; fire applies to workers the user hired. `labs/teammates/src/adapter.ts:524-531` (`editTeammate`, `resetTeammate`, `fire` doc comments), `goals/teammates-lab/a-standard-teammate-takes-your-edits/goal.md` (Outcome and legs a-d). This page does not need the edit rule beyond one sentence, which it can leave to C-22 (Workers). [ref]/[link]
8. **The screenshot and the key step wait for the final screens.** Nothing on this sheet describes a first-run screen that is not already in `tr` and the goal check `goals/teammates-lab/first-run-shows-its-context/goal.md`. Treat every screen fact as "as of this build". [verify at the screenshot]
9. **`pnpm build:assets` is a one-time step for the DevTool only; the app runs without it.** `rd:38`, `rd:45` ("It reads `not served` until `pnpm build:assets` has run"), `dev:526-535` (the DevTool is optional beside an app, and a missing build prints a note). The root `package.json:9` (`build:assets`). [page: one line, in the get-the-starter step]
10. **The sitemap's four answers.** (1) What two things do you need? A clone with Node and pnpm, and one model key: `rd:32`, `rd:51`. (2) Where to look first when a worker does not answer? See section 5. (3) Which folder holds the workers? Section 6. (4) Is anything stored, and where? Section 7. Each is a [page] fact.

## 1. What you need

- Node.js 22.18 or newer, and pnpm (version: flag 5). `rd:32`. Engines floor: `packages/fsdev/package.json:57-59` (`"node": ">=22"`). [page]
- One model key. Any of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `AI_GATEWAY_API_KEY` or `OPENROUTER_API_KEY` is a model credential the framework recognizes. `rd:51`, `gs/setting-up-models.md:15-21`. For the Teammates starter as it ships, `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY` works as is. `rd:51`. [page: the two that work as is; the five-provider list is [ref] `reference/models`]
- Another provider's key needs that provider's package installed at the repository root, such as `pnpm add -w @ai-sdk/anthropic`, and the model setting changed. `rd:51`. The framework picks a provider only when it has both a key and an installed package. `gs/setting-up-models.md:82` ("one whose provider has a working key *and* an installed SDK package"). [ref; page links to C-18 and `reference/models`]
- Coding-agent sign-ins (Claude Code, Codex, Cursor) are needed only for the coding workers. `rd:57`. A search key (`TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`) is optional and only `researcher`'s web search uses it. `rd:55`, `tr:220-224`. [page: one sentence that neither is needed to talk to a worker; the table is [ref]]
- Fetching a page needs no key. `tr:223-224`. [ref]
- Git is needed: the starter's working folder must be a git checkout, and the clone is one. `tr:226-229`. [ref]. [verify] whether the page must say "git" for the clone step; the clone command already implies it.

## 2. Get the starter

The current route, as the existing page states it. `rd:30-45`:

```bash
git clone https://github.com/fixpoint-labs/flow-state-dev
cd flow-state-dev
pnpm install
pnpm build:assets   # one time: builds the DevTool
```

- The clone URL is `https://github.com/fixpoint-labs/flow-state-dev`. `rd:35`. [page; O2 may change the command]
- The starter lives in `labs/teammates`. `rd:23`. Its package name is `@flow-state-dev/teammates`. `tp:2` (`"name": "@flow-state-dev/teammates"`), `tp:4` (`"private": true`). [page]
- A starter is a complete app: React pages, a team of workers, and the flows they run on. `rd:21`. [page, one sentence; S-1 defines it]
- To build your own app on one, fork the repository and work in the starter's folder. `rd:28`. Pulling framework updates is a normal `git pull` from upstream. `rd:28`. [page, one sentence, or link]
- The Teammates starter is a small team you talk to one at a time: Chief of Staff, researcher and writer each keep one long conversation, message each other where you can see it, and hand code changes to a coding agent (Claude Code, Codex or Cursor) that runs in the background. `rd:23` (call the first worker "Chief of Staff", flag 6). [page]
- `pnpm install` also installs a pre-push hook for contributors. `rd:142`. [cut: it is the contributor path]
- There is a second starter, `labs/claude-code-style`, run the same way (`pnpm --filter @flow-state-dev/claude-code-style dev`). `rd:24`, `rd:42`. [page: at most one clause, or leave to Next]

## 3. Add your model key

- Set keys "in your shell or in a `.env.local` at the repository root". `rd:47`. [page]
- The loader reads a file named `.env.local` in the directory the command runs from and in every parent directory up to the filesystem root. The command `pnpm --filter @flow-state-dev/teammates dev` runs in `labs/teammates`, so the repository root's `.env.local` is found by that walk. `env:81-104`, `tp:12`, `rd:47`. [page: the repository root; the walk is mechanism and stays out]
- A variable already set in the shell wins over the file. `env:15`, `env:62-74` ("Existing values win (first-set wins)"). [ref; one clause is fair on the page: "a key already in your shell wins"]
- A file line is `KEY=VALUE`; quotes around the value are stripped; `#` starts a comment; blank lines are ignored. `env:24-60`. [ref]
- `.env.local` is in the repository's `.gitignore`. `.gitignore:7` (`.env.local`). So the key stays out of a commit. [page, one clause]
- Example, the file the page shows. `rd:47-51`:

  ```bash
  # .env.local, at the repository root
  OPENAI_API_KEY=sk-...
  ```

  [page; `sk-...` is a placeholder. Title the block `.env.local`.]
- The default model is `openai/gpt-6-luna`; `TEAMMATES_MODEL` changes it. `tc:52`, `tr:210`. [ref `reference/environment`; the page may name the default in one clause]
- `TEAMMATES_MODEL`, `TEAMMATES_WORKDIR`, `TEAMMATES_HARNESS`, `TEAMMATES_STORE`, `TEAMMATES_USER`, `TEAMMATES_TREE`, `TEAMMATES_RUNS`, `TEAMMATES_RUN_TIMEOUT_MS`, `TEAMMATES_SETUP`, `GITHUB_TOKEN`, `TEAMMATES_CHECKS` are the settings the starter reads. `tr:198-218`, `tc:1-38`. [ref `reference/environment`; the page names none beyond the key]
- Gateway keys cover several providers at once. `gs/setting-up-models.md:23`. [ref]
- **What the failure looks like with no key (used by section 5).** A model with no key and no package fails with: `No provider available for "openai". Tried: direct package (not installed), gateways (none configured for this provider). Install the provider package, set its API key, or configure a gateway (e.g. AI_GATEWAY_API_KEY).` `cm:1224-1231`, tested in `packages/core/test/models/create-model-resolver-intents.test.ts:285` and `.../create-model-resolver-loading.test.ts:51`. [ref; the page can say the reason appears in the conversation]

## 4. Run it

- The command is `pnpm --filter @flow-state-dev/teammates dev`. `rd:40`, `tr:200-202`. [page]
- That script is `vite build && tsx ../../packages/fsdev/bin/fsdev.ts dev --app @flow-state-dev/teammates`: it builds the pages, then starts `fsdev dev` with the starter as the app. `tp:12`. [page: "builds the pages and serves them with its backend", `rd:45`, `tr:204`; the script text is mechanism]
- `fsdev dev` serves the app's pages at the root of one port, and the flow API on the same port under `/api/flows`. `dev:1-12` (module comment), `dev:584` (the `basePath: "/api/flows"` on the app's server), `dev:618` (the banner's `API:` line). [page]
- The default port is 4200 on `127.0.0.1`. `dev:130` (`"-p, --port <port>", "Port to listen on", "4200"`), `dev:123` (`DEFAULT_HOST = "127.0.0.1"`), `rd:45` ("`http://localhost:4200` by default"). The banner prints `localhost` for the loopback address. `shownUrl` in `dev:` (the function below `withSignals`). [page]
- The banner lists `App:`, `DevTool:`, `Flows:`, `API:` and `Data:`. `dev:613-619`. The `App:` line is the address to open. `rd:45`. [page; this is also the sentence "Open the address it prints as `App:`"]
- The command opens the browser by default; `--no-open` stops it. `dev:140` (`--no-open`), `dev:622` (`if (o.open) openBrowser(...)`). [verify] The pnpm script passes no `--no-open`, so the browser opens by itself on a machine with a desktop. [page: one clause]
- The DevTool is a browser inspector that shows every run, item and state change as it happens. It has a port of its own beside the app and the banner's `DevTool:` line gives it; it reads `not served` until `pnpm build:assets` has run. `rd:45`, `dev:2-12`, `dev:530-545` (the DevTool's own server), `dev:614` (the `DevTool:` line prints `not served` when absent). [page, one sentence, linked to the DevTool page]
- `fsdev dev` binds loopback by default, so the app answers only on your machine. `dev:14-17`, `dev:123`. [page, one clause]
- Stop the server with Ctrl+C (SIGINT); it prints `Shutting down...` and closes cleanly. `dev:666` (`withSignals`: `"\nShutting down...\n"`). [verify at the terminal] [page, optional]
- At startup the starter logs which coding agents this machine can run and what to run for any that cannot. `rd:57`, `packages/harness-manager/src/kit/harnesses-kit.ts:111` (`logReadiness`), `th:390` (`logReadiness: true`). [page: one sentence in the "worker does not answer" section; not needed to start]
- If the working folder is not a git checkout, or does not ignore `.fsdev/`, the starter warns or refuses to start. `tr:226-231`, `th:331-335` (the `.gitignore` warning is never fatal). The starter's default folder is the clone itself. `tr:208` (`TEAMMATES_WORKDIR` default: "the root of this repository"), `rd:59`. [ref]
- Hiding: if the pages are not built, the app refuses to start with `the pages are not built at <dir>. Run: pnpm --filter @flow-state-dev/teammates build`. `labs/teammates/cli/index.ts:21-29`. The `dev` script builds them first, so the reader meets this only when running `fsdev dev` by hand. [ref]
- `--watch` is not passed by the starter's script, so a saved change to a file the config loaded needs a restart. `tp:12`, `dev:99-105` (what `--watch` does). `rd:82` ("Edit the body and its instructions change on the next start"). [page: one clause in section 6]

## 5. Talk to a worker

What the reader sees and does. Source: `tr` (the starter's README, an existing user doc) and the goal checks; screens may change (flag 8).

- The page opens on the first worker in the list. `labs/teammates/src/App.tsx:23-25`. [verify] The list reads Chief of Staff, researcher, writer; the three coding workers (Claude Code, Codex, Cursor, on the `coder` flow) are not on the list. `tr:12-15`, `tr:99-101` ("Each agent is a worker of its own, off the list and never messaged"), `labs/teammates/src/App.tsx:178-179` (`teammates = workers.filter((w) => !w.takesTasks)`). [page: the three names; the coding agents are one clause or left to C-17]
- Each worker has one conversation that goes on. `tr:24-25`. Choosing a worker opens it. `rd:23`. An empty conversation says "Say hello to <name>. This is your one conversation with it." or, for a worker that hands work on, "<name> runs the work with you: it asks <workers> and starts coding tasks on <agents>. This is your one conversation with it." `labs/teammates/src/lib/first-run.ts:21-31`. [page: one of these lines, quoted]
- An empty conversation offers lines to start with, such as "What can the team do for me?"; clicking one puts it in the box and sends nothing. `labs/teammates/src/lib/first-run.ts:33-43`, `tr:165-166` ("An empty conversation offers a few lines to start with"), goal `goals/teammates-lab/first-run-shows-its-context/goal.md` leg `starter`. [page]
- Enter sends. `tr:34`. [page]
- An answer streams in as it is written. Tools a worker uses show in the conversation as it uses them, each saying what it acted on. `tr:26-31`, `tr:279-281` ("The conversation follows its session's stream"). [page]
- A first conversation to try, from the starter's own README: with a working folder whose README says the launch date, ask Chief of Staff "Ask researcher for our launch date, and help me outline the post." It answers and messages researcher, which reads the date from the README. `tr:233-239` (written there with the old name "Lead"). [page: use as the "Talk to a worker" example. The README's default working folder is this repository, whose README does not say a launch date. [verify] pick a prompt that works on the clone: "What can the team do for me?" is on the empty conversation's own offer, `first-run.ts:38-42`, and needs no file.]
- Workers message each other where you can see it: a line such as *Messaged researcher* shows in the sender's conversation, and opening it shows the other worker's turn. `tr:84-90`. [page; C-23 owns messaging]
- A worker with real work hands it out as a task and the result lands back as one line. `tr:92-101`. [link to C-24]
- A coding task needs a coding agent signed in. Without one, the task fails at once with a line naming the agent and what to run. `tr:121-131` ("Codex isn't set up on this machine: ..."). [ref; the page says coding tasks need a sign-in and links on]

**If a worker does not answer (sitemap question 2).** The facts the page can use to say where to look first, in the order the reader meets them:

1. **The conversation.** A turn that fails leaves one line under the worker's name with the reason, and a Retry on the newest turn only. `labs/teammates/test/failed-turn.test.tsx:1-10` (header comment) and its first test (`entries[2]` is `kind: "failed"` with `reason` and `retryable: true`); `tr:264` ("What the screen reads" table: a failed turn and *Retry*), `labs/teammates/src/components/flow-state/request-recovery.tsx:45-52`. A model that cannot be reached because of a missing key arrives as that reason. `cm:1224-1231` (the message), `labs/teammates/test/failed-turn.test.tsx` (fixture reason "AI_GATEWAY_API_KEY is not set" is a fixture, not the live text). [page: "the reason is on the line; fix the key and press Retry"]
2. **The strip over the conversation** names the model the starter was started with. `labs/teammates/src/components/ContextStrip.tsx:32-33` (`model {context.model}`), `goals/teammates-lab/first-run-shows-its-context/goal.md` (leg `strip`). [page: a reader can confirm which model it is trying]
3. **The terminal** running `pnpm ... dev` prints startup lines: the banner, then the coding-agent readiness table, then a warning if the working folder does not ignore `.fsdev/`. `dev:660-672`, `packages/harness-manager/src/kit/harnesses-kit.ts:111`, `th:331-335`. [page]
4. **The page cannot reach the server.** The first read failing draws a full-screen connection page that retries on its own at 2, 4, 8 seconds, capped at 30, so a server still starting comes back without a click. `labs/teammates/src/components/flow-state/connection-screen.tsx:1-12`, `connection-screen.tsx:23-26` (`retryDelayMs`). A later loss is a banner over the page. [page, one sentence: it means the server stopped, look at the terminal]
5. **The DevTool** (the `DevTool:` address) shows every run, item and state change. `rd:45`. It reads `not served` until `pnpm build:assets` has run. `rd:45`. [page: one sentence, the place to look when the conversation shows nothing]
6. **A provider key set after the app started.** The key is read at start, so restart after adding or changing it. `env:62-74` (the loader runs once at start); `dev:239-260` (env files load before the config). [verify] by running; the code reads env at start and nothing re-reads it. Safe to state as "restart after changing the key". [page]
7. **Order for the page.** The sitemap asks where the page tells the reader to look first. The first look is the conversation: the reason is on the failed line, and a missing key is the likeliest reason. The terminal is second. [page; the order is the writer's call, these are the facts it rests on]

## 6. What you are looking at (where the workers are)

- The workers are files, one per worker, in the starter's `workforce/` folder: `labs/teammates/workforce/teams/teammates/workers/<name>/WORKER.md`. `rd:65`, `tw/workers/` listing: `chief-of-staff`, `claude-code`, `codex`, `cursor`, `researcher`, `writer`. [page: sitemap question 3's answer]
- Folder shape: `workforce/teams/<team>/workers/<name>/WORKER.md`, and the team's own `workforce/teams/<team>/TEAM.md`. `rd:65`, `rd:84`, `tw/TEAM.md`. [page]
- The team here is `teammates`, so the worker ids are `teammates.chief-of-staff`, `teammates.researcher` and `teammates.writer`. `tw/` folder names, `labs/teammates/test/failed-turn.test.tsx:23` (`LEAD = "teammates.chief-of-staff"`), `packages/workforce/README.md` (the record table: the id is `<teamId>.<workerName>`). [page, optional; C-22 owns ids]
- `TEAMMATES_TREE` can point at another tree; the default is `workforce/` in the starter. `tr:213`, `tc:13`. [ref]
- `TEAM.md` holds what every worker on the team is told, such as which codebase they work on. `rd:84`, `tw/TEAM.md:6-12`. [page, one clause]
- A `WORKER.md` is frontmatter between `---` lines, then the instructions in Markdown. `description` is the only required key. `name` is the display name, `tools` lists tools it may call, and `flow` picks the flow it runs on. `rd:65-82`, `packages/workforce/README.md:115` (the sentence "`description` is the only required setting in a `WORKER.md`"). [page for `description` and `name`; the rest [ref] `reference/worker-md`]
- The file the page shows, `researcher`, as it is in the repo (use the real file, not the README's trimmed copy). Full text, `tw/workers/researcher/WORKER.md:1-15`:

  ```md
  ---
  name: researcher
  description: Finds facts for the team, in the working folder's files and on the web, and replies to whoever asked.
  icon: "🔎"
  color: teal
  tools: [globProjectSource, readProjectSource, grepProjectSource, search, fetch, listRoutines, saveRoutine, pauseRoutine, deleteRoutine]
  ---

  You find facts: dates, prices, what a document or the code says. Look them up, never guess: read the
  working folder's files with `globProjectSource`, `grepProjectSource` and `readProjectSource`, and
  search the web with `search` and `fetch`. Say where each fact came from: the file's path, or the
  page's URL.

  When another worker messages you, look it up and answer them the way their message says: when they
  asked for a reply, your answer here goes back to them; when they didn't, answer with `sendMessage`,
  `inReplyTo` set to their message's id. When a task is filed for you, answer it here. When the user
  asks you directly, answer them here.
  ```

  The root README shows a shorter copy with `tools: [globProjectSource, readProjectSource, grepProjectSource, search, fetch]` (`rd:67-80`) and the existing S-1 page (`pages/start/what-flow-state-is.md`) shows a three-line variant titled `workforce/teams/teammates/workers/researcher/WORKER.md` with a made-up shorter description and `tools: [search, fetch]`. **A page example must be the file as it is, or trimmed by dropping whole body paragraphs and the `listRoutines`-family tools with a stated reason.** `icon` and `color` are settings the starter's own flow reads for the worker list; they are not framework keys. `rd:82`, `th:367-368`, `tc` (n/a). [page: say `icon` and `color` are the starter's own]
- Editing a body changes the worker's instructions on the next start. Adding a folder adds a worker. `rd:82` ("Add a folder and you've added a worker. Edit the body and its instructions change on the next start."). [verify] against the code: the standard workers are read from the files when the app starts. `packages/workforce/README.md:76-80` ("`readDeclaredRoster` reads that tree"), `apps/docs/docs/workforce/workers-on-disk.md` (existing page; the sibling C-22 sheet, `pages/concepts/workers.facts.md` flag 2, states the folder is read at start). [page]
- A worker that names no `flow:` runs on the built-in `agent` flow. `packages/workforce/README.md:43` ("That record names no `flow:`, so it runs on the built-in `agent` flow"). The coding workers name `flow: coder` and `harness:`. `tw/workers/cursor/WORKER.md:1-5`. [page, one clause; or link to C-22]
- The page's React UI is under the starter's `src/`, built by Vite; the backend is `host.mts` and `fsdev.config.mts`. `rd:88`, `tc:42`, `th:1-6`. [page, one sentence or leave to S-1]
- The server file is `labs/teammates/fsdev.config.mts`; it default-exports the app's `FlowState`. `tc:50` (`export default await openTeammates({...})`), `th:1-6`. The starter lists its kits there: `workforce`, `harnesses`, `claudeCode`. `th:352-398`. [page, one sentence; the reader of S-1 has met kits]
- The packages the starter uses are listed in `tp:107-133`. [cut]

## 7. Is anything stored between restarts, and where (sitemap question 4)

The four questions (owner, who can see it, where stored, how many) for each stored part.

**The workers' files.**
- Owner: you; they are files in your clone. `rd:28`, `rd:65`. Who sees it: anyone who can read the repository. Where: `labs/teammates/workforce/`. How many: one `WORKER.md` per worker, one `TEAM.md`; every user of the app gets each worker. `packages/workforce/README.md:6` ("every user has those"). [page]

**Conversations.**
- Owner: the user. The starter runs as one user, `you` by default (`TEAMMATES_USER`), in the organization `teammates-lab`; it takes every request as that user, whatever user the request names. `tr:186-192`, `th:407-408` (`resolvePrincipal: () => ({ userId: options.userId, orgId: "teammates-lab" })`), `tc:53`. Who can see it: that user. The page can say "the starter has one user, so it is yours". [page]
- Where: a SQLite file. By default `labs/teammates/.fsdev/teammates.sqlite`. `th:418-420` (`LAB_DATA = ./.fsdev`; `defaultStore = join(LAB_DATA, "teammates.sqlite")`), `tr:211` (`TEAMMATES_STORE`: "`.fsdev/teammates.sqlite` here"), `rd:59`. `.fsdev/` is ignored by git. `labs/teammates/.gitignore:2`, `.gitignore` (`**/.fsdev/**`). [page]
- How many: one conversation per worker per user. "This is your one conversation with it". `labs/teammates/src/lib/first-run.ts:23`, `wc:146-171` (`ensureWorkerSession` returns "the user's session with the worker ... or a new session ... created on the worker's flow at an id derived from the user, the organization, the flow and the criteria. Two calls at once get the same session."), `tr:24` ("goes on for weeks"). [page]
- What survives a restart: the conversation, a turn a crash cut off (listed as interrupted), and the task the turn started (carries on, or ends with its reason). `th:48-49` ("a restart keeps every conversation"), `th:403` (`durable: true`), `goals/teammates-lab/survives-a-crash-mid-turn/goal.md` (Outcome; signals `conversation`, `cut-turn`, `task`). `rd:59` ("so conversations and tasks survive a restart"). [page: one sentence]
- The worker keeps a window of recent turns word for word (50 turns) and folds older ones into a running summary. `tr:24-27`. [ref]/[C-22, C-12]; one clause at most.
- Memory (what workers remember about you) is kept by the starter's memory system in the same store. `th:305`, `th:376-378` (`mem.capability`, `afterAnswer: mem.captureFromItems`). [cut: C-11 or memory pages own it]

**Teammates you hire, and edits.**
- Owner: the user. Hiring, editing and firing write rows on the user's own roster; nothing restarts and no file changes. `th:40-41`, `tr:174-178`, `labs/teammates/src/adapter.ts:524-531`. Where: the same SQLite store. How many: as many as the user hires. [page: one sentence, optional; belongs to C-22]
- A page edit of a worker that comes from a file makes the user's own copy under the same id. Reset brings the file's version back. `labs/teammates/src/adapter.ts:524-531`, the goal `a-standard-teammate-takes-your-edits` (legs a-d). Another user keeps the file's version. [ref/link to C-22]

**Tasks (board rows).**
- Tasks live in the conversation that filed them, in the same store. `tr:267` ("Task lines | the conversation board's rows"). [cut for this page; C-24 owns them]

**Two more SQLite files and a runs folder.**
- Clock routines and GitHub polls tick from two more SQLite files beside the store (`teammates-clock.sqlite`, `teammates-poll.sqlite`). `th:345-346`, `tr:194-195`. A coding run's worktree goes under `.fsdev/teammates-runs/`. `tr:214`. [ref `reference/environment`]

**Resetting.** Stopping the server does not clear anything. To start from nothing, delete the `.fsdev/` folder in `labs/teammates` while the server is stopped. [verify] by running; the code reads the file path from `TEAMMATES_STORE`/`defaultStore` and creates `.fsdev/` when missing (`tc:48`: `mkdirSync(dirname(store), { recursive: true })`). `TEAMMATES_STORE` points at another file for a second set of conversations. `tr:211`. [page: one sentence, only after the owner checks it]

**The figure "What just started"** (browser, the app's server process, your store). The facts it can state:
- Browser: the starter's React pages, served from the same address as the API. `dev:584`, `rd:45`.
- The app's server process: one `fsdev dev` process that serves the pages, the flow API under `/api/flows`, and runs the workers; the DevTool is a second port on the same process. `dev:1-12`, `dev:530-545`. [page]
- Arrow: the browser calls the API and the process streams answers back as they are written (SSE). `tr:279`, `rd:6` ("output streamed to the browser as it is written"), The streaming claim rests on `rd:6` and `tr:279-281`. [page: label `CALLS · STREAMS BACK`]
- Your store: the SQLite file, which holds the conversations and outlives the process. Hatching, per the figure standard, marks "outlives the request". `th:48-49`, `rd:59`. [page]
- The model provider is outside the three columns; the server process calls it with your key. `rd:51`, `cm:1224-1231`. [page, one clause or a small off-figure mention]

## 8. What the page does not state (link only, per the sitemap)

- Model setup beyond one key: intents, fallback ladders, gateways, the resolver (C-18 and `reference/models`). `gs/setting-up-models.md:41-113`. [ref]
- Store choice: SQLite for the starter; in-memory, Postgres and a filesystem store exist (C-14). `gs/installation.md:77`. [ref]
- Every environment variable (`reference/environment`). `tr:198-218`; `apps/docs/docs/configuration/environment.md` is the existing page. [ref]
- The starter's coding tasks, review flow, routines, keyboard shortcuts, working folder, checks and setup commands. `tr:34-62`, `tr:92-190`. [cut or other pages]
- The `fsdev` CLI's other commands (`run`, `chat`, `serve`, `block`). `packages/fsdev/README.md`. [link]

## 9. Source conflicts and neighbour fixes for later passes

- **Neighbours that state something the code or another source contradicts** (not this page's job; flagged for the neighbour pass):
  - `tr:12`, `tr:24`, `tr:233-241` and `rd:23` name the first worker "Lead"; the file says "Chief of Staff" (flag 6).
  - `tr:220` says only `AI_GATEWAY_API_KEY` works; `rd:51` and the code say an OpenAI key does too (flag 3).
  - `tr:178` says the file workers cannot be edited; the adapter and the goal say an edit makes a user's own copy (flag 7).
  - `rd:32` says pnpm 10.4.1; `package.json:5` says pnpm 12.18.0 (flag 5).
  - `gs/quick-start.md` and `gs/installation.md` describe adding packages to your own app, not running a starter; the page merges only their prerequisites and key setup, and C-1x pages own the rest. `gs/quick-start.md:11-15` (prerequisites: Node 22, pnpm or npm/yarn, one provider key), `gs/quick-start.md:33-49`.
- **Existing docs say the key goes in a shell `export` or `.env.local`.** `gs/quick-start.md:35-43` (shell exports), `gs/setting-up-models.md:25-39` (`.env` file, `.env.local` for Next.js). The `fsdev` loader reads `.env.local` only (flag 2). A page that writes `.env` will not work with `fsdev dev` unless `--dotenv` is passed. `dev:136`.

## 10. Revise round 1: what moved to Reference, and what the page keeps

The page keeps one clause and a link for each of these; the detail is a Reference row, not page text.

- R-15 (`reference/environment`): where the key is read from (shell, `.env.local` at the repository root), shell wins over the file, git ignores `.env.local`, `AI_GATEWAY_API_KEY` as the alternative; environment variables are read once at startup, so a change needs a restart. Sources: flag 2, section 3.
- R-21 (`reference/models`): default model `openai/gpt-6-luna`; the starter's helper calls always use an OpenAI model (`th:80-81`, `th:410-411`), so another provider's key alone is not enough; another provider needs its package installed and a setting changed. The page states only the consequence.
- R-35 (`reference/cli`): `fsdev dev` builds nothing itself beyond the starter's `vite build`, runs one process, prints `App:` and `DevTool:` lines, defaults to port 4200, binds localhost only; the DevTool reads `not served` until `pnpm build:assets`. The page keeps the `App:` address, 4200 and Ctrl+C.
- R-22 (`reference/errors`): a failed turn leaves one line with the reason and a Retry on the newest turn; a missing or wrong key is a cause.
- R-06 (`reference/items`): the connection screen when the server is unreachable, retrying by itself (flag in section 5, item 4). The page keeps: restart the server and the screen reconnects.
- R-28 (`reference/worker-md`): `description` required, `name` shown in the list, body is instructions, `tools`; edits apply on the next start.
- R-29 (`reference/workforce-folder`): `teams/<team>/workers/<name>/WORKER.md` becomes a worker; `TEAM.md` is team-wide instructions.
- R-16 (`reference/stores`): SQLite file `.fsdev/teammates.sqlite` in `labs/teammates`, git-ignored; one user, one conversation per worker.
- R-17 (`reference/durable-execution`): a restart keeps every conversation; a turn cut off by a crash is listed as interrupted.

Revise round 3: the page now states, in place, three facts it had left to links. Key step: `.env` is not read, `.env.local` is git-ignored (`.gitignore:7`), a shell key wins (`env:62-74`, `env:81-104`). Editing: the body of `workforce/teams/teammates/workers/researcher/WORKER.md` is the instructions, and the starter passes no `--watch`, so an edit applies on the next start (`tp:12`, `rd:82`). Storage: conversations, an interrupted turn and its task survive a restart; the file is `labs/teammates/.fsdev/teammates.sqlite`, git-ignored; one conversation per worker per user and the starter runs as one user (`th:48-49`, `th:418-420`, `tr:211`, `first-run.ts:23`); deleting `.fsdev/` with the server stopped starts fresh (still [verify] by running; section 7, Resetting).

Worker list (resolves the name question): the list shows each worker's frontmatter `name`: `Chief of Staff`, `researcher`, `writer` (`tw/workers/*/WORKER.md:2`). `chief-of-staff` is the folder name and id, used in the figure. The list holds only the three non-coding workers: `labs/teammates/src/App.tsx:178` (`teammates = workers.filter((w) => !w.takesTasks)`), and the three coding workers (Claude Code, Codex, Cursor, `flow: coder`) are held apart in `coders` (`App.tsx:179`). The page says so in the intro.

Revise round 2: the figure and its description say `Chief of Staff`, the `name` the list shows (`tw/workers/chief-of-staff/WORKER.md:2`); `chief-of-staff` stays only as the folder and id. A worker hands code changes to the coding agents: the Chief of Staff's own description says it "starts coding tasks for code changes" (`tw/workers/chief-of-staff/WORKER.md:3`). The dev script runs `fsdev dev` (`tp:12`).
