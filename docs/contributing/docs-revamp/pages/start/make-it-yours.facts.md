# Facts for Make it yours (S-3, start)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (`labs/teammates`). No spec, issue, changeset, `docs/internal`, `CLAUDE.md` or PR was read. The kits and CLI are built, so no fact here is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `cli` = `apps/docs/docs/cli/overview.md`
- `api` = `apps/docs/docs/api/cli.md`
- `dt` = `apps/docs/docs/devtool/overview.md`
- `ds` = `apps/docs/docs/devtool/setup.md`
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `tips` = `apps/docs/guides/development-tips.md`
- `loop` = `apps/docs/docs/cli/agent-dev-loop.md`
- `run` = `packages/fsdev/src/commands/run.ts`
- `dev` = `packages/fsdev/src/commands/dev.ts`
- `dw` = `packages/fsdev/src/dev-watch.ts`
- `lab` = `labs/teammates` (the one example: a Teammates app with `researcher`, `writer` and coding workers)
- `wk` = `packages/workforce/src`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/worker-md`, the CLI reference); the page links, does not state it. **[verify]** not confirmed against running code. **[ran]** observed by running the lab on this machine. **[cut]** mechanism or history; never on the page.

## Flags against the page plan (read first)

1. **A worker is not run with a bare `fsdev run <flow> <action> -i '{…}'`.** The workers run on the built-in flow `agent`, and its one message action is `respond`. A session of `agent` must name its worker when it is created, so the first run needs `--seed-session '{"workerId":"teammates.researcher"}'`. Without it the run is refused: `The initial state of a session of flow "agent" doesn't fit its stateSchema at "workerId": Required Pass the session's initial state with --seed-session. Nothing was written` (exit code 2). [ran] `run:462-464`, `wk/workers/installation.ts:621-629` (`createCheck` refuses a session born with no `workerId`), `wk/workers/keys.ts:37` (`WORKER_ID_STATE_KEY = "workerId"`), `wd:152` ("a session of `agent` created with `state: { workerId: "engineering.lead" }`"). No existing user doc shows this command; the page's example must carry the flag. [page]
2. **Seed once, then reuse.** The seed is read when a session is born. A second call with `--session <id>` and the same seed ran cleanly. [ran] The page can show the seed on the first command and say `--session` continues the same conversation; a seed on later calls is not needed. `cli:42`, `tips:35`. **[verify]** that omitting the seed on a later call with `--session` works (not run; the code path `run:410-421` loads the held session and only seeds when `seedData` is given, so it should).
3. **A run reaches the DevTool through the app's store, and only for the same user.** With an `fsdev.config.*`, `fsdev run` uses the app's own stores (`run:297`, `cli:54`), the same config `fsdev dev` serves (`dev:335`, `api:149`). So a run lands in the store the DevTool reads, but only when the user is the same: the run's user is what the app's resolver returns, else `devuser`; the DevTool acts as the config's `devtool.userId`. `run` flag docs: `run:138-139`, `ds:100-115`, `lab/host.mts:408-409` (the lab's resolver and `devtool.userId` are both the lab's one user, `you`). A starter that sets both to one user shows its runs in the DevTool. **[verify]** the Teammates starter's config does the same: the starter is not in this repo, only the lab. [page, one clause: "the same app, so the same data"]
4. **The existing docs list five NDJSON event types; the code emits more.** `cli:40` and `loop:14` name `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`. `run:58-65` (`FlowEvent`) also has `item_updated`, `item_done` and `suspended`. The page needs only: one JSON object per line, ends in `flow_complete` or `error`. [page] The full list is [ref]; the neighbour pages (`cli:40`, `loop:14`, `tips:20-25`) are incomplete, flagged for the neighbour pass.
5. **Figure: the dashed outline on the run is true of the terminal output only.** `fsdev run` writes the run's session and request records to the app's store (`run:297`, `run:532` writes the run through `runAction` on those stores), and the DevTool reads those records back later, restarts included (`dt:41`, `dt:237`: "restored from the log"). The printed lines last one invocation; the record outlives it. Figure rules: dashed = "lasts one action run", hatching = "outlives the request" (`docs/contributing/user-docs-figures.md:42-43`). Either draw the run as the printed output only and say so in the caption, or hatch the trace column. A box cannot carry both.
6. **A new worker or an edited file needs a restart, or `--watch`.** The tree is read once at startup. `wd:956` ("It does not watch the tree. Read it once, at startup"). `fsdev dev --watch` restarts on a saved `WORKER.md` and on a new one. `api:141`. [page]
7. **Neighbour contradiction on editing a standard worker in the app** (not this page's claim, flagged because the page's "who owns it" depends on it). `wd:271-273` says nobody can edit a standard worker while the app runs. The code makes a user's own copy under the same id, read before the file until reset. `wk/workers/hire-blocks.ts:11-14`, `:81-90`; `wk/workers/standard-workers.ts:3-12`. Consequence for this page: a file edit reaches every user *who has not edited that worker in the app*. [page, one clause; detail is [ref] on the Workers concept page]
8. **The brief the page edits is not the lab's file.** S-1 shows a trimmed `researcher` (`name`, `description`, `tools: [search, fetch]`, two lines of body). The lab's `researcher` carries `icon`, `color`, nine tools and a longer body (`lab/workforce/teams/teammates/workers/researcher/WORKER.md:1-17`). The page does not reprint researcher's file: it names the path and says to add one line at the end of the instructions (`Begin every answer with AHOY.`), so the lab's `icon`, `color`, tools and second paragraph stay. The proofreader file is shown whole because it is new. The commands below were run against the lab's file, not the trimmed one.
9. **Stdout is not only NDJSON in the lab.** The lab prints "Coding harnesses on this machine" readiness lines on stdout (`lab/host.mts`, `logReadiness: true`), which breaks a `jq` pipe unless filtered. [ran] That is the lab's setting, not the framework's. Keep it off the page; if the starter does the same, the example should not pipe through `jq`.

## 1. Opening: the app is files you own

- A worker is a Markdown file; someone who does not write TypeScript can add one or change what one has been told by editing a document. `wd:37`. [page]
- The workers a team has are the folders under `workforce/teams/<team>/workers/`. `wd:17-35`. [page]
- A model call from the terminal still needs the provider's key: `run` and `chat` call the engine in-process, but "a generator still calls its model provider over the network and still needs that provider's key". `cli:26`. [page, one clause, where the reader first runs it]

## 2. Rewrite a worker's brief

- A worker's brief is its `WORKER.md`: settings between `---` fences, instructions below them. `wd:59`, `wd:182` (`body`: "the instructions below it"). [page]
- Everything below the second `---` is the worker's instructions. `wd:59`, `wd:182`. [page]
- `description` is the only key the file requires; an empty one is refused at startup naming the file: ``WORKER.md in "<name>/" must declare a non-empty `description` ``. `wd:76`, `wk/loader/read-workforce-directory.ts:275-278`. [page: "`description` is required"; the refusal text is [ref]]
- Every `WORKER.md` is a **standard worker**: every user of the app has it, configured as the file says. `wd:271-273`. [page]
- A turn reads its worker's settings by loading the worker, so the next turn after a restart uses the new file. `wd:358`. [ran] An edit that appended "Always begin your answer with the word AHOY." to the lab's `researcher` made the next `fsdev run` answer `AHOY, hello!`, in an existing session (`--session facts-try`) and a new one. The file was restored afterwards. [page: the loop is edit, run again]
- **What to do to see it follow the new brief.** `fsdev run` starts a new process each time, so the next run reads the saved file. [ran] `fsdev dev` reads the tree once at startup, so a running `fsdev dev` needs a restart, or start it with `--watch`, which restarts on a save and reloads open pages. `wd:956`, `api:118`, `api:133-145`, `dw:1-27`, `dw:172-198` (it walks the config's folder, so a `WORKER.md` under it counts). [page]
- With `--watch`: a restart is a new process; a config with in-memory stores starts empty each time; a failed start prints the error and waits for the next save; `--watch` binds loopback only. `api:143-145`. [ref]; the page keeps one clause: "your data survives if the app's store is SQLite" is [verify] for the starter, so cut it.
- What a user's conversation looks like after the edit: the file edit reaches the next turn of every session of that worker, but a user who already edited that worker in the app has their own copy, read before the file. See flag 7. [page, one clause]

### Four questions for the stored part: the `WORKER.md`

- **Who owns it?** You: it is a file in your repo, in the app's `workforce/` folder. `wd:17-35`, `lab/workforce/teams/teammates/workers/`. [page]
- **Who can see it?** Everyone who has the repo. At run time its content reaches every user's copy of the worker; no user can write it. `wd:271-273`, `wk/workers/standard-workers.ts:3-12` ("Nothing stores them. They are read from the loaded files each time ... nothing a user does at run time can write one"). [page]
- **Where is it stored?** On disk, in the repo, at `workforce/teams/<team>/workers/<name>/WORKER.md`. Not in the database. `wk/workers/standard-workers.ts:5` ("Nothing stores them"). [page]
- **How many exist?** One per worker, shared by all users. A user may add their own copy only by editing in the app (flag 7). `wk/workers/standard-workers.ts:3-12`. [page]

## 3. Add a worker

- Add a folder with a `WORKER.md` under the team: `teams/<team>/workers/<name>/WORKER.md`. `wd:17-35`, `wd:148-152`. [page]
- The worker's id is its team folder and its own folder joined with a dot: `teams/teammates/workers/researcher/` is `teammates.researcher`. `wd:148-152`. [page] The id is how a session, a coordinator's `delegates:` and a task name the worker. `wd:152`. [page, one clause]
- The smallest file is a `description` and a body. A folder `proofreader/` with a two-line front matter (`description:` only) and one line of body became the worker `teammates.proofreader` and answered: `The quick brown fox.` plus a line of changes, from `fsdev run agent respond --seed-session '{"workerId":"teammates.proofreader"}' -i '{"message":"Fix: teh quick brwn fox"}'`. The folder was removed afterwards. [ran] [page]
- A worker with no `flow:` runs on the built-in `agent` flow. `wd:76`, `wd:13-15`; "needs no flow of yours". [page]
- A name that matches no worker is refused: `No worker "teammates.nobody". Nothing was written`, exit code 2, nothing stored. [ran] `wk/workers/installation.ts:687` (`No worker "${workerId}".`). [ref]
- A folder inside `workers/` that produces no worker is always named in the loader's `errors`, and the docs advise failing the start on it. `wd:257`, `wd:267`. [ref]; the page may say "the app names the file that is wrong" if it needs one clause.
- A new `WORKER.md` is seen after a restart. With `fsdev dev --watch`, adding a new file in the config's folder, "such as a new worker's `WORKER.md`", restarts it. `api:141`, `dw:1-27` ("A file created under the config's directory after a child started ... asks the parent to start it over"). [page]
- Who sees the new worker: every user of the app, as a standard worker. `wd:271-273`. [page]
- The Teammates page shows a roster of the workers; a new standard worker appears on it after the restart. **[verify]** the lab's page code was not driven in a browser here; `lab/test/roster-follows.test.tsx` covers the roster following the server. Keep the claim to "the team has a new worker".
- Optional keys the page can skip: `name`, `tools`, `model`, `delegates`, `flow`, `resources`, `references`, `packages`. `wd:61-88`. [ref `reference/worker-md`]

### Four questions for the stored part: the new worker folder

Same four answers as the `WORKER.md` above (it is one). The id is the folder path, so renaming the folder is a different worker; an earlier session of the old id is not moved. **[verify]** that last clause is inferred from `wd:152` (the id is how everything names the worker) and not run. Do not state it.

## 4. Look underneath: run one flow from the terminal

- `fsdev run <flow> <action>` runs one action in-process. NDJSON on stdout. `cli:15`, `cli:38-42`. [page]
- No HTTP server, no SSE, no browser. `cli:26`. [page]
- The command uses the app's own wiring when `fsdev.config.ts` is in the current folder: its flows, models and stores. Run it from the app's folder: the config search looks only in the current folder. `cli:54`, `loop:33`. [page]
- Input is `-i <json>` inline, or `-f <path>`. `run:134-135`, `cli:40`. [page] `--session <id>` continues a session. `run:137`, `cli:42`. [page] `--seed-session <json|path>` sets the session's starting state. `run:140`, `cli:74-76`. [page] `--quiet` silences stderr. `run:145`, `loop:50`. [ref]
- The flow for a worker is `agent`, the action is `respond`, and the input is `{ "message": "..." }`. `wk/agent-worker-flow.ts:122` (`AGENT_FLOW = "agent"`), `:1467-1495` (the `respond` action, which takes `{ message }`), `wd:408-411` ("Exactly one public action ... named `respond`"). [page] A wrong action name lists the real ones: `Action "nope" not found on flow "agent". Available actions: respond, standingRules, setWorkProject, ...` (exit 2). [ran] `run:353-354`. [ref]
- A flow name that is not registered lists the flows the config has: `Flow "<flow>" not found in fsdev config (<path>). Available flows: ...` (exit code 4). `run:292-293`, `exit-codes.ts:18`. [ref]
- **What it prints.** stdout: one JSON object per line, each with a `type`. For the researcher reply, 41 lines of events: the user's message as an `item_added` and `item_done` (`type: "message"`, `role: "user"`), then `block_trace` items, one per block that ran, a `router_decision`, `state_change` items, `content_delta` lines carrying the reply text, and a final `flow_complete`. [ran] `run:58-65`, `run:693` (`mapStreamEventToNdjson`). [page: the shape in one or two lines, no full dump]
- The last line is `{"type":"flow_complete","output":"Hi! What can I help you with?","durationMs":6136,"items":41}`: `output` is the reply text for the built-in worker, `durationMs` the run's time, `items` the number of items. [ran] `run:574-578`. [page] A failed run ends in `{"type":"error","message":...}` and exit code 1. `run:581-585`, `run:601`, `exit-codes.ts:15`. [page: one clause]
- Each item in the stream carries which block made it: the `block_trace` item has `blockName`, `blockKind`, `provenance` and, once done, `output` and `duration`. [ran] Block names seen for one researcher reply, in order: `agent-resolve-worker`, `worker-steer-or-talk`, `agent-user-turn`, `agent-run-planned`, `agent-run`, `agent-answer`, `agent-after-answer`, plus the app's memory and history-summary blocks. [ran] The names are the lab's composition. Do not list them on the page; one name, `agent-answer`, may be quoted as "the block that wrote the reply". **[verify]** that `agent-answer` is the model call: `wk/agent-worker-flow.ts:910` (`answerName: "agent-answer"`).
- stderr carries the human lines: `[fsdev] running as <user> in organization <org> (from the app's resolver)`, then runtime logs. `run:413` (principal line), `wk`/`principal.ts:166-175`. [ran] [page, one clause: "stderr says who the run was"]
- A run that stops to wait for a person ends with a `suspended` event and exit code 0. `run:570`. [ref]
- A run that has started background work keeps the process open until the work ends. `cli:78-121`. [ref]
- Where the run is recorded: `fsdev run` writes the session and request to the app's store, so the DevTool of the same app can show them. `run:297`, `run:532`, `cli:54`, `ds:128`. [page]
- A run whose model is not available: the app's resolver decides which model each worker uses; `-m` overrides it. `cli:58`, `run:480-482`. [ref]. **[ran]** this machine's environment had `FSDEV_INTENT_*` variables that the lab refused (`createModelResolver: FSDEV_INTENT_UTILITY: Invalid model format`) until they were unset: an environment fault, not framework behaviour. Not on the page.

### Four questions for the stored part: a run's session and request

- **Who owns it?** The user the run was made as: the app's resolver's user, else `devuser`; `--user` and `--org` name another. `run:138-139`, `principal.ts:38`, `principal.ts:166-175`. [page, "the run is recorded as you"]
- **Who can see it?** That user, in that organization. A session another user owns is refused: `Session "<id>" belongs to ...`. `run:388-392`, `principal.ts:188-191`. [ref]
- **Where is it stored?** In the app's own stores, the same ones the app serves (`run:297`). Without a config, the default is the SQLite file `.fsdev/data/fsdev.db`. With a config, whatever the config's store is (the lab's is `.fsdev/teammates.sqlite`, `lab/fsdev.config.mts:11,47`). `ds:126-132`, `dev:610-620` (the `Data:` line the server prints). [page: "in the app's own store"]
- **How many exist?** One session per `fsdev run` unless you pass `--session` (a new id `sess_<time>_<random>` each call), and one request per run. `run:373` (the generated id). [ran] [page]
- Terminal output is not stored. `--capture <path>` writes the events and the result to a JSON file you name. `run:147`, `run:607`. [ref]

## 5. Watch the same run in the DevTool

- The DevTool is a browser inspector for flows: sessions, items, state and traces. `dt:9`. [page]
- Install `@flow-state-dev/devtool` with the CLI, and run `fsdev dev` from the project root. `dt:13-23`, `ds:10-19`. Without the package the command stops: `DevTool assets not found. Install @flow-state-dev/devtool or build the devtool app:` (exit code 3). [ran] `dev:717`. [page: one clause]
- `fsdev dev` starts a server for the flow API and the DevTool; open the printed URL, default `http://localhost:4200`; the browser opens by itself unless `--no-open`. `dt:25`, `dt:33-45`, `dev:140`. [page]
- The command prints, on stderr: `DevTool server running at <url>`, then `Flows:`, `API:` and `Data:` lines. `dev:610-619`, `ds:63-71`. [page, optional]
- With `--app <package|dir>` the app's own pages take the root of the port and the DevTool moves to a port of its own; the printed lines are `App:` and `DevTool:`, and each page the app serves carries the DevTool's address. `dev:612-614`, `api:149-157`. [page, if the starter runs this way] **[verify]** which command the starter uses to run the app: the starter is not built in this repo; the lab's script is `vite build && tsx ../../packages/fsdev/bin/fsdev.ts dev --app @flow-state-dev/teammates` (`lab/package.json` `scripts.dev`). The page must say "the DevTool address `fsdev dev` prints" and not name a port.
- To see a run: work down the navigator. Open the flow (`agent`), then the session, then the request. `ds:73`. [page] A flow registered as a collection opens into its copies first; the flow `agent` is a collection (`wk/agent-worker-flow.ts:1467-1472`, `cardinality: "collection"`), but with the workforce kit its copy is registered at `agent` (`wd:299`, "One copy per flow, at the flow's own kind"), so the row to open is `agent`. [ran: the CLI addresses it as `agent`; the navigator row was not seen because the DevTool assets are not built here] **[verify]** in a browser.
- Open a session directly by adding `?session=<id>` to the DevTool's address. `dt:91-93`. [page] This is why the example passes `--session`: a chosen id, such as `make-it-yours`, is one the reader can paste. `run:373` (an unnamed run gets a generated id, which stdout does not print). [ran]
- A run made by `fsdev run` while `fsdev dev` is up appears the next time the page reads, such as on a reload; the open page does not update as the run writes. `ds:128` (stated for the no-config default). **[verify]** for a config: `run:298-300` puts the run's writes on the change bus, "so a view elsewhere on these stores hears them", which suggests a live update in the same process only. Tell the reader to reload.
- The Stream tab lists every item of a request in order. `dt:126-128`. [page]
- The trace view assembles the items into a timeline by block: block name, instance, parent, phase, input and output of each block. `dt:130-140`. [page: one sentence; the panels are B-06 and the Reference]
- A generator's panel shows the resolved system prompt, the user message and the history the model saw. `dt:140` (gated by `FSDEV_TRACE_OBSERVABILITY`, "on by default in development"). [page: this is how the reader sees their brief in the model's input; one clause, **[verify]** in a browser that the rewritten brief appears in the system prompt for the built-in `agent`] [ref for the flag]
- The DevTool acts as one user: the config's `devtool.userId`. A run made as another user does not show under it. `ds:100-115`, `dt:85-89`. [page, one clause; same-user is the starter's job]
- The DevTool remembers the last session opened under each flow copy. `dt:89`. [cut]
- The panels (Replay, Session state, Task boards, Inventory) are not on this page. `dt:146-240`. [ref]
- Data persistence of the DevTool's view: sessions and requests survive a restart of `fsdev dev`, because they are in the app's store. `ds:128`, `dt:41`. [page, optional]

### Four questions for the stored part: what the DevTool shows

- **Who owns it?** It owns nothing. It reads the sessions, requests and items the app's store holds, as the user it is set to. `dt:9`, `dt:85-89`. [page]
- **Who can see it?** Whoever opens the DevTool address on that machine. `fsdev dev` binds loopback by default. `dev:123` (`DEFAULT_HOST = "127.0.0.1"`), `api:116`. [page, one clause]
- **Where is it stored?** Nowhere of its own; the trace is rebuilt from the run's recorded items (`dt:237`: "restored from the log"). Only its theme choice lives in the browser's local storage. `dt:29-31`. [cut]
- **How many exist?** One DevTool per `fsdev dev`, many sessions in it. [cut]

## 6. What the page does not explain (links only)

- Revise round 1 moved to Reference: the required `description` setting and the `flow:` default (`reference/worker-md`); `fsdev run` flags, the stdout line types, the error and `suspended` endings, the stderr user line, and the `?session=` deep link and reload note (`reference/cli`). The page keeps the worker id (the `--seed-session` example uses it), what `--session` and `--seed-session` are for, and the `flow_complete` last line.

- Every `WORKER.md` setting: `reference/worker-md`. `wd:61-88`. [ref]
- The DevTool's panels: B-06 and `reference/devtool`. `dt:120-243`. [ref]
- What a flow is: C-05 (the flows concept page). The page may say "a flow is the backend a worker runs on" in a clause. `wd:13-15`. [ref]
- Hiring and forking in the app, and `reset`: the Workers concept page. `wk/workers/hire-blocks.ts:81-90`. [ref]

- Revise round 2 put back on the page, as one clause each: `description` is the only required setting and a worker with no `flow:` runs on `agent` (§3, `wd:76`); a mistyped worker id is refused with nothing stored (§3, `installation.ts:687`); a session of `agent` must name its worker at creation, the seed is read only then, omitting it is refused with exit 2 and nothing stored, and a later message passes `--session` with the same id (flags 1, 2; the run without the seed on a later call is [verify], so the page does not claim it); a running `fsdev dev` needs a restart or `--watch` while each `fsdev run` reads the saved file (§2, flag 6).

- Revise round 3 put back on the page, in the DevTool section: the run is in the app's store which the DevTool reads (`ds:128`); install requirement and the `DevTool assets not found` stop (`dev:717`); navigator path flow, session, request, or `?session=` (`ds:73`, `dt:91-93`); reload for a run made while open (`ds:128`, [verify] for a config); Stream tab and trace view (`dt:126-140`); generator panel shows the system prompt (`dt:140`); one-user caveat `devtool.userId` (`ds:100-115`). The page does not claim the AHOY line appears in the prompt ([verify]).

## 7. Examples

All run against `labs/teammates` unless marked.

| Example | Command or file | Result | How checked |
| --- | --- | --- | --- |
| The brief, before and after | `workforce/teams/teammates/workers/researcher/WORKER.md`, one line added to the body | next run's reply starts `AHOY` | [ran], restored after |
| A new worker | `workforce/teams/teammates/workers/proofreader/WORKER.md`, `description` and one line of body | `fsdev run agent respond --seed-session '{"workerId":"teammates.proofreader"}' -i '{"message":"Fix: teh quick brwn fox"}'` replied `The quick brown fox.` and a change line | [ran], removed after |
| Run one flow | `pnpm fsdev run agent respond --session make-it-yours --seed-session '{"workerId":"teammates.researcher"}' -i '{"message":"Say hello in one short sentence."}'` | NDJSON, last line `flow_complete` with `output` | [ran] (with `--session facts-try`) |
| A bad worker id | same, `--seed-session '{"workerId":"teammates.nobody"}'` | stderr `No worker "teammates.nobody". Nothing was written`, exit code 2 | [ran] |
| No seed | same without `--seed-session` | stderr `... doesn't fit its stateSchema at "workerId": Required Pass the session's initial state with --seed-session.`, exit code 2 | [ran] |
| The DevTool | `pnpm fsdev dev` | needs `@flow-state-dev/devtool`; stops with `DevTool assets not found` if it is not installed | [ran] for the failure; the browser view [verify] |

Commands in the lab run through `pnpm fsdev <args>` (the lab's `scripts.fsdev`, `lab/package.json`); user docs write `pnpm fsdev run ...` (`cli`, `tips:21`). The page uses `pnpm fsdev`.

## 8. Not stated, for lack of an observable surface

- A starter install command, and a starter's own dev command and port (the starter is not built in this repo).
- Whether the starter's `researcher` file has the `tools:` line S-1 shows, and whether its config sets `devtool.userId` to match its resolver (flag 3).
- What the DevTool's tab for the trace is called in the UI: the docs name a "Stream tab" (`dt:128`) and a "trace view" (`dt:130`); the component names are `trace-view.tsx` and `stream-view.tsx` (`packages/devtool/src/react/components/workspace/`). The label on the tab was not read.
