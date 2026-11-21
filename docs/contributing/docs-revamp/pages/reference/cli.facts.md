# Facts for CLI (R-35, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments (command registrations count as the surface), tests, and `goals/`. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[source]** marks a fact read from the command's code where no test or exported doc comment pins it; **[test]** marks a fact a test pins; **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run against a deployed project. Where an existing doc and the code disagree, the code wins and the fact says so under "Contradictions found".

Paths are from the repo root. Abbreviations:

- `run` = `packages/fsdev/src/commands/run.ts`, `dev` = `.../commands/dev.ts`, `serve` = `.../commands/serve.ts`, `chat` = `.../commands/chat.ts`, `block` = `.../commands/block.ts`, `gen` = `.../commands/gen.ts`, `ui` = `.../commands/ui.ts`, `wt` = `.../commands/worktrees.ts`, `bench` = `.../commands/benchmark.ts`
- `rt` = `packages/fsdev/src/resolve-runtime.ts`, `rf` = `.../resolve-flow.ts`, `rb` = `.../resolve-block.ts`, `lc` = `.../load-config.ts`, `le` = `.../load-env.ts`, `pr` = `.../principal.ts`, `ls` = `.../local-store.ts`, `ex` = `.../exit-codes.ts`, `idx` = `.../index.ts`, `icm` = `.../import-config-module.ts`, `da` = `.../dev-app.ts`, `dw` = `.../dev-watch.ts`
- `ch/*` = `packages/fsdev/src/chat/*`
- `rdoc` = `apps/docs/docs/api/cli.md`, `ov` = `apps/docs/docs/cli/overview.md`, `cf` = `apps/docs/docs/cli/configuration.md`, `ic` = `apps/docs/docs/cli/interactive-chat.md`, `adl` = `apps/docs/docs/cli/agent-dev-loop.md`, `rd` = `packages/fsdev/README.md`
- `sm` = `packages/shift-manager/cli/bin.ts`, `smr` = `packages/shift-manager/README.md`
- `ui-reg` = `packages/ui/registry.json`, `ui-tok` = `packages/ui/registry/token-defaults.css`, `ui-ov` = `apps/docs/docs/ui/overview.md`
- Tests live in `packages/fsdev/test/`: `rct` = `run-command.integration.test.ts`, `bct` = `block-command.integration.test.ts`, `sct` = `serve-command.test.ts`, `dct` = `dev-command.test.ts`, `gct` = `gen-command.test.ts`, `lct` = `load-config.test.ts`, `ect` = `exit-codes.test.ts`

## What the page is

A Reference page: tables and lookups, no narrative. Three tables the plan asks for, plus the lookups "Which flag sets the session?" and "What does `fsdev block` take?":

1. Every `fsdev` command and flag.
2. The config file (`fsdev.config.*`): name, search order, what it must export, the flags that touch it.
3. Output formats: what `fsdev run`, `fsdev block`, `fsdev chat`, `fsdev benchmark` and `fsdev worktrees` print, and where, and the exit codes.

Reference carries no word budget (`docs/contributing/user-docs.md`, page types table). The "no table has more than six rows" line in "Before you call it done" is for narrative pages; a flag table that lists every flag cannot meet it, so pass 3 splits tables by command and does not cap them.

The command is `fsdev`, from `@flow-state-dev/fsdev` (`packages/fsdev/package.json` `bin.fsdev`; `rd:1-15`). Node 22 or later (`packages/fsdev/package.json` `engines.node` `>=22`). `@flow-state-dev/devtool` is an optional peer dependency; `fsdev dev` needs it, the other commands do not (`packages/fsdev/package.json` `peerDependenciesMeta`, `rd` fsdev dev section, `dev:689-716`). `fsdev serve` never mounts the DevTool (`serve:104-107`).

Do not state: the program's `--version` string. It is hardcoded `"0.0.0"` (`packages/fsdev/src/cli.ts:20`) and says nothing about the installed release.

## 1. Commands

Nine top-level commands are registered, in this order in the source: `block`, `chat`, `dev`, `gen`, `run`, `serve`, `ui`, `worktrees`, `benchmark` (`packages/fsdev/src/cli.ts:22-30`). `ui` has two subcommands, `add` and `list` (`ui:56,87`).

| Command | What it does | Cite |
|---|---|---|
| `fsdev run <flowKind> <action>` | Runs one action in the terminal and prints one JSON event per line to stdout. | `run:131-134` |
| `fsdev block <specifier>` | Runs one block alone through the test harness and prints one JSON document. | `block:54-62` |
| `fsdev chat [flow] [action]` | A terminal REPL over your flows. | `chat:43-46` |
| `fsdev dev` | HTTP server for the flow API plus the DevTool (or your own app's pages). | `dev:125-129` |
| `fsdev serve` | HTTP server for the flow API and MCP endpoints, no DevTool. Needs a committed config. | `serve:37-45` |
| `fsdev gen` | Writes the module an app registers its code from, with a generator one of its dependencies supplies. | `gen:357-364` |
| `fsdev ui add <components...>` / `fsdev ui list` | Installs components from the UI registry, or lists them. | `ui:51-60,87-90` |
| `fsdev worktrees <root>` | Lists, or removes, the git worktrees a workspace host made for coding runs. | `wt:229-239` |
| `fsdev benchmark <file>` | Runs a `defineBenchmark` file and prints a scorecard. | `bench:241-243` |

Also a separate command, `shift-manager` (section 9), from `@flow-state-dev/shift-manager`. It is not an `fsdev` subcommand.

`run`, `block` and `chat` call the engine in the same process: no HTTP server and no SSE. A generator in them still calls its model provider over the network and still needs that provider's key. `dev` and `serve` start a host. `[doc]` `ov:26`.

## 2. Flags shared by several commands

A flag that means the same thing on every command that takes it. One row each, then a "which commands" cell. This is the table that answers "Which flag sets the session?"

| Flag | Meaning | Commands | Cite |
|---|---|---|---|
| `-s, --session <id>` | The session to run in, so state carries across invocations. Without it, `fsdev run` mints a fresh session id for every run (`sess_<time>_<random>`). On `chat` it resumes a session for the initially bound flow. | `run`, `chat` | `run:138,374`, `chat:47`, `ch/state.ts:527` |
| `-i, --input <json>` | Inline JSON input. | `run`, `block` | `run:135`, `block:58` |
| `-f, --input-file <path>` | JSON input from a file. Relative paths resolve from the working directory. A leading BOM is ignored. | `run`, `block` | `run:136`, `block:59`, `parse-input.ts:50-72` |
| `-m, --model <model>` | Forces every generator that runs in this process onto one model id. | `run`, `block`, `chat`, `dev`, `benchmark` | `run:137`, `block:60`, `chat:48`, `dev:138`, `bench:244` |
| `-u, --user <id>` | Run as this user. | `run`, `chat` | `run:140`, `chat:49` |
| `--org <id>` | Run in this organization and skip the app's resolver. | `run`, `chat` | `run:139`, `chat:50` |
| `--flow-dir <path>` | Replace flow discovery with only the directories given. Repeatable. Refused (exit 2) when a config loads. | `run`, `chat`, `dev` | `run:142`, `chat:51`, `dev:134`, `rt:370-377` |
| `--config <path>` | Load this config file instead of searching the working directory. | `run`, `chat`, `dev`, `serve` | `run:144`, `chat:53`, `dev:136`, `serve:43` |
| `--no-config` | Ignore any config, use directory discovery. | `run`, `chat`, `dev`. Not `serve`. | `run:145`, `chat:54`, `dev:137`, `serve` (no registration) |
| `--dotenv <path>` | Load a `.env` file before the working-directory `.env.local` walk-up. Repeatable. | `run`, `chat`, `dev`, `serve`, `benchmark` | `run:143`, `chat:52`, `dev:135`, `serve:44`, `bench:260-265` |
| `--quiet` | Silences stderr runtime logs. | `run`, `chat` | `run:146`, `chat:55`, `rt:459` |
| `--log-level <level>` | Stderr log level: `debug`, `info`, `warn`, `error`. Anything else exits 2 with `Invalid --log-level "<x>"`. | `run` (default `info`), `chat` (default `warn`) | `run:147,510`, `chat:56,244`, `rt:455-470`, `rct:435-444` |
| `--store <kind>` | Without a config: `sqlite` (default) or `filesystem`. Exits 2 if a config loaded. Exits 2 for any other value. | `run`, `dev`. Not `chat`. | `run:149`, `dev:140`, `ls:154-167` |
| `-p, --port <port>` | Port to listen on. `0` picks a free port. | `dev` (default 4200), `serve` (default `$PORT`, then 3000) | `dev:129,166-172`, `serve:41,65-79` |
| `--host <host>` | Host to bind. | `dev` (default `127.0.0.1`), `serve` (default `$HOST`, then `0.0.0.0`) | `dev:130,122`, `serve:42,97-102` |
| `--allow-unauthenticated` | Bind a non-loopback host even if a flow has no authentication. | `dev`, `serve` | `dev:131`, `serve:45` |
| `--format <format>` | Output format. | `block` (any value prints JSON), `benchmark` (`table`, `markdown`, `json`) | `block:61`, `format-output.ts:9-11`, `bench:62-76,266` |

Notes on shared flags:

- `-i` and `-f` together exit 2: `Cannot specify both --input and --input-file`. Invalid inline JSON exits 2: `Invalid JSON in --input flag`. An unreadable input file exits 2: `Cannot read input file: <path>`. Invalid JSON in the file exits 2. `parse-input.ts:31-75`, `[doc]` `rdoc:20`.
- With neither `-i` nor `-f`, the action receives `{}` (`run:539`, `parse-input.ts:75` returns `undefined`, `run:360`).
- `--model` with a config: on `run` and `chat`, the id is routed through the config's own resolver, so its gateways and providers still apply (`run:482-488`, `chat:234-242`, `model-override.ts:91-104`). On `dev`, `--model` with a config exits 2: `--model can't be combined with fsdev.config.*` (`dev:325-331`, `dct:37-49`). `--model` does not override evaluator model strings (`model-override.ts:84-90,96-102`).
- `--model` reaches only generators that run in the command's own process. Background work a config hands to a queue runs elsewhere under that process's model configuration. `[doc]` `ov:56-70`. A line on stderr says so at each dispatch that loses the override; `--quiet` silences it. `ov:63-70`.
- `--dotenv` is `--dotenv`, not `--env-file`, because Node and tsx consume `--env-file` before the CLI sees it (`le:317-326`, `[doc]` `cf:73`).

## 3. Per-command flags and arguments

### `fsdev run <flowKind> <action>`

Registered at `run:131-150`. The first argument is the flow **instance** id: a singleton's kind, or a collection member's own id. A collection's bare kind names nothing (`run:287-296`, `rd` fsdev run paragraph, `rdoc:21`).

Flags (all on the sheet above) plus these `run`-only flags:

| Flag | Meaning | Cite |
|---|---|---|
| `--seed-session <json\|path>` | Seeds session state. Inline JSON if the value starts with `{` or `[`, else a file path. Merged into session state before the run. | `run:141`, `run:102-128`, `[doc]` `ov:72-76` |
| `--capture <path>` | Writes the whole run (command, events, result) to one JSON file. Additive with stdout. Parent directories are created. A failed write is reported on stderr and does not change the exit code. | `run:148`, `run:195-220,607-629` |

Behaviors:

- **Order of checks.** Flow found (exit 4) → action found on the flow (exit 2) → input parsed (exit 2) → identity resolved (exit 2 on refusal) → existing session checked against the identity (exit 2) → seed applied → run. Nothing is written before the identity and session checks pass. `run:287-296,305-314,349-357,359,364-369,384-412`.
- **Unknown flow** (exit 4): lists the ids that exist. Without a config: `Flow "<id>" not found. Available flows: ...` then `Searched: <dirs>`, then any modules that failed to import. With a config: `Flow "<id>" not found in fsdev config (<path>). Available flows: ...`. `run:289-296,305-314`, `[doc]` `rdoc:352-363`.
- **Unknown action** (exit 2): `Action "<a>" not found on flow "<f>". Available actions: ...`. `run:350-357`.
- **A session belongs to the instance that started it.** Running it through another instance exits 2 and writes nothing: `Session "<id>" belongs to flow instance "<x>", not "<y>"; nothing was written`. `run:385-391`, `[doc]` `rdoc:21`.
- **`--seed-session` on a new session** goes through the flow's `stateSchema` and `session.createCheck`. It refuses a server-owned field. On an existing session it refuses a change to a readonly field. Each refusal exits 2 and ends with `Nothing was written`. A seed that is not valid JSON or cannot be read also exits 2, with a different message and no `Nothing was written`: `Invalid JSON in --seed-session`, `Cannot read seed file for --seed-session: <path>` or `Invalid JSON in seed file for --seed-session: <path>` (`run:102-127`). `run:394-409,427-476`, `[test]` `rct:632-690`.
- **A flow whose `session.createCheck` needs initial state** (a worker flow needing a `workerId`, in the test fixture) refuses a new session with no seed: the refusal is exit 2, nothing written. The built message is `${err.message}${hint} Nothing was written`, so the hint `Pass the session's initial state with --seed-session.` sits just before the closing sentence and the message ends `Nothing was written`. `run:427-470`, `[test]` `rct:651-656`. Generalised from the plan row, see "Plan rows" below.
- **Existing session, no seed, or the same readonly value:** runs normally. `[test]` `rct:658-666`.
- **Two runs racing to create one session with different readonly values:** one runs, one is refused. `[test]` `rct:668-681`.
- **Who a run is** (identity): section 6.
- **Where a run keeps data:** section 8.
- **Waiting for a person.** A flow that pauses for a person is held, not failed. The command prints a `suspended` event, exits **0**, and writes a waiting report to stderr (unless `--quiet`). The run is not finished. `run:567-576,640-667,682-691`, `[doc]` `rdoc:55-83`.
- **After `flow_complete`, the process can stay up** while background work the run started in this process finishes. Only with a config; the drain covers in-process dispatched children (`dispose()` runs it). Bounded by `dispatchDrainTimeoutMs`, a `createFlowState` option, default 30 seconds (`packages/engine/src/flowstate/createFlowState.ts:151`). On timeout it cancels what is left, names the requests and sessions it gave up on, and exits; that report goes to stderr even under `--quiet`. `--quiet` and `--log-level error` silence the "still waiting" line, not the wait. `[doc]` `ov:91-101,123-129`.
- **Job queue modes** are `colocated` (the default), `enqueue-only` and `process-only` (`packages/engine/src/flowstate/types.ts:67`); there is no `dispatch-only`. A queue worker started by the config is drained by `dispose()`. The page defers all of this to Background work (R-19) and states only the in-process drain and its default. `[doc]` `ov:103-109`.
- **With no config**, background work cannot start; the dispatch fails with `NoRequestHostError` (`code: "no-request-host"`). `[doc]` `ov:111-121`.
- **Without a config and a failed `intent/*` model**, stderr adds a hint that no `fsdev.config.*` was found and names the four filenames. Not printed under `--no-config` or `--quiet`. `run:588-593,674-680`.
- **On exit, a config's `FlowState` is disposed**, releasing pooled resources. A disposal failure prints `Warning: failed to dispose fsdev config: ...` and does not change the result. `run:248-261,634-637`, `[doc]` `cf:110-115`.
- **Concurrent writers.** The app and the CLI can write the same `.fsdev/data`; a file is never left half-written when two processes write at once, but two processes updating the same record can lose one of the updates. The page defers this to Stores (R-16) and does not state it. `[doc]` `cf:114-115`. In-memory store profiles write nothing durable. `cf:112`. A config that declares a queue worker starts it for the run and drains it on dispose. `cf:113`.

### `fsdev block <specifier>`

Registered at `block:54-62`. This is the answer to "What does `fsdev block` take?".

| Argument or flag | Meaning | Cite |
|---|---|---|
| `<specifier>` | Path to a block file, absolute or relative to the working directory. | `rb:53-54` |
| `-i, --input <json>`, `-f, --input-file <path>` | Input, as for `run`. | `block:58-59,95` |
| `-m, --model <model>` | Model override. Unmocked generators call the real provider. | `block:60,105-109` |
| `--format <format>` | Default `json`. Only `json` exists; any value formats as JSON. | `block:61,153`, `format-output.ts:5-11` |

- **The file must default-export the block.** A block is recognised by having a `kind` of `handler`, `generator`, `evaluator`, `sequencer` or `router`, a `name`, and a `run` function. `rb:10-34,53-83`.
- **Failures to load exit 4**, with these messages: `Block file not found: <path>`, `Failed to import block file: <message>`, `Block file has no default export: <path>`, `Default export is not a valid BlockDefinition (must have kind, name, and run): <path>`. `rb:56-81`, `[test]` `resolve-block.test.ts:42,53,64` (exit 4 in each). The doc comment on `resolveBlock` says exit 2 for the last two; the code and tests say 4.
- **It runs the block alone:** no flow, no session, user id `cli-user`. `block:101-103`, `[doc]` `ov:44-46`.
- **Output** is one pretty-printed JSON document on stdout:

  ```json
  { "success": true, "block": { "kind": "handler", "name": "counter" }, "output": { "count": 1 },
    "schemaValidation": { "input": { "passed": true }, "output": { "passed": true } },
    "execution": { "durationMs": 12 } }
  ```

  `schemaValidation.input` and `.output` are each `{ passed: boolean, errors?: string[] }`. A block with no schema passes. Validation never stops the run; it is reported. When the block throws, `success` is `false`, `output` is `null`, an `error: { message, stack? }` is added, and `schemaValidation.output.passed` is `true` (it is not checked). `block:13-32,34-51,119-151`.
- **Exit codes:** 0 on success, 1 when the block throws (`bct:92`), 2 for bad input flags, 4 for a block file that cannot be loaded. `block:155`, `parse-input.ts`, `rb`.

### `fsdev dev`

Registered at `dev:125-141`. Flags: `-p, --port <port>` (default `4200`), `--host <host>` (default `127.0.0.1`), `--allow-unauthenticated`, `--app <package|dir>`, `--watch`, `--flow-dir <path>`, `--dotenv <path>`, `--config <path>`, `--no-config`, `-m, --model <model>`, `--no-open`, `--store <kind>`.

- **What it starts.** One process serves the flow API at `/api/flows` and the DevTool's pages at every other path, on one port. `dev:572-585`, `[doc]` `rdoc:129`. It opens a browser unless `--no-open` (best effort). `dev:616-618,718-730`.
- **Startup banner**, on stderr. Default (no `--app`):

  ```
    DevTool server running at http://localhost:4200

    Flows:  <ids, comma separated>
    API:    http://localhost:4200/api/flows
    Data:   <where>
  ```

  `dev:602-614`. With the default bind, the banner prints `localhost` for `127.0.0.1` and drops a trailing slash (`dev:669-672`). `Data:` is `.fsdev/data/fsdev.db (SQLite)` without a config, `config: <path>` with one (`dev:352,430`, `ls:182`). `Flows:` lists flow instance ids. `dev:351,429`.
- **With `--app`**, the first lines become `App:     <url>  (<pages dir>)` and `DevTool: <url>` (or `DevTool: not served`), then the same `Flows:`, `API:`, `Data:` lines. `dev:603-609`. `not served` appears when the DevTool package is not installed (or its assets are not built); the app still starts and stderr says `DevTool not served beside the app, so its pages get no fsdev-devtool-url: <reason>`. `dev:497-506`.
- **Without the DevTool** and without `--app`, it exits 3: `DevTool assets not found. Install @flow-state-dev/devtool or build the devtool app:` (`pnpm add @flow-state-dev/devtool`). `dev:499-501,710-715`.
- **No config** and no flows found: exits **4** with `No flows found. Searched: <dirs>` and `Place flow definitions in src/flows/ or flows/, or use --flow-dir.`, plus a list of any modules that failed to import. `dev:382-390`.
- **No config**: flows are discovered (section 4); they are registered in a router over local stores (SQLite at `.fsdev/data/fsdev.db` by default); `--model` is applied. Durable execution is on, so a paused request is held and answered from the DevTool. `dev:372-434`, `[doc]` `rdoc:129`.
- **With a config**: it serves the config's own `FlowState`, with its registry, resolver and stores. `--model` is refused (exit 2) and so is `--flow-dir` (exit 2); `--store` is refused (exit 2). `dev:323-358`, `dct:37-60`, `ls:154-161`. The config's `devtool` block (`userId`, `bearerToken`) is handed to the DevTool page, on a loopback host only. `dev:357`, `devtool-config.ts:20-25`, `[doc]` `cf:50-52`.
- **A config that fails to initialise** exits 3: `Failed to initialize fsdev config <path>: <message>`. `dev:346-349`.
- **Port.** The value must be all digits and at most 65535, else exit 3: `Invalid port: <value>`. `0` picks a free port. `dev:166-172`.
- **A bind or listen failure** (for example the port is taken) exits 3 with the server's message. `dev:590-598`.
- **`--host`.** The default is loopback only. A non-loopback host: (a) needs a config, else exit 3 `Refusing to bind <host>: a non-loopback host needs an fsdev config (--config), so its authentication can be checked.` (`dev:373-381`); (b) runs the same authentication check as `fsdev serve` (`dev:14-16`, `[doc]` `rdoc:116`), which `--allow-unauthenticated` skips (`dev:131`, `serve:45`); (c) is refused, exit 3, when the config hands its page a bearer token (`dev:359-370`); (d) leaves the debug endpoints closed, see below.
- **Debug endpoints** (what the DevTool's Resources panel reads). On for a loopback host. Forced off on any non-loopback host (`dev:290-294`). Without a config, loopback runs open them directly (`dev:420-424`). With a config on loopback, they are on unless the shell or a `.env` file already set the matching variables (`FSDEV_DEBUG_ENDPOINTS`, `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL`, `FSDEV_TRACING_LEVEL`); the command only sets defaults (`dev:295-301`). Not for production. `[doc]` `rdoc:131`.
- **`--watch`.** Loopback only; with any other `--host`, exit 3: `Refusing --watch on <host>: ...` (`dev:179-185`). It restarts the server on the same port when a file the config loaded changes, a file in the config's folder (such as a `WORKER.md`) changes, a new file appears in that folder, or a `.env.local` that `fsdev` loaded changes; open pages reload. A data file, anything under `node_modules`, and a folder whose name starts with a dot do nothing (`dw:3-18`, `[doc]` `rdoc:133-145`). A restart is a new process, so a config with in-memory stores starts empty each time (`[doc]` `rdoc:143`). If the server fails to start after a save, the error prints and `fsdev dev` waits for the next save (`[doc]` `rdoc:143`, `dw:6-9`). With `--port 0` the free port is picked once and kept (`dw:6-9`, `[doc]` `rdoc:141`). After the first start it prints `Watching: a save to a file the config loaded restarts the server, and open pages reload.` (`dev:212-214`). A shutdown signal exits within 3 seconds even if the close is unfinished (`dev:484,638`).
- **`--app <package|dir>`.** Serves your own app's pages at the root; the DevTool moves to a port of its own. A directory with an `index.html`, or a package that exports `getAssetPath()` (a function returning that directory). A relative path or package name resolves from the directory you run the command in. The path of a package's module file also names that package. Errors exit 3: no such directory, no `index.html`, a package that is not installed, no `getAssetPath()`, or one that throws or returns no string. `da:1-12,59-92,104-116`, `[doc]` `rdoc:147-161`. The API stays at `/api/flows` on the same origin. `dev:578`. Each HTML page carries `window.__FSD_DEVTOOL_CONFIG__` (loopback host only) and `<meta name="fsdev-devtool-url" content="...">`; the meta is absent when the DevTool is not served or `--host` is `0.0.0.0` or `::`, since a browser cannot reach an all-interfaces address. `dev:105-106,544-552,675-677`, `[doc]` `rdoc:157`. With `--watch`, a package that also exports `getSourceRoot()` is served from that folder through the app's own Vite; with nothing returned, or no Vite installed there, the built pages are served and the command says so. `da:51-60`, `[doc]` `rdoc:159`.
- **Identity.** The DevTool acts as `devuser` unless the config's `devtool.userId` says otherwise. `DEFAULT_LOCAL_USER_ID = "devuser"` (`packages/core/src/types/auth.ts:47`), `[doc]` `cf:52`, `apps/docs/docs/devtool/setup.md:111`. A run from `fsdev run` appears in the DevTool when it ran as the same user. A running `fsdev dev` does not hear a separate process's writes as they happen, so an open page shows them the next time it reads, such as on a reload. `ls:106-113`, `[doc]` `apps/docs/docs/devtool/setup.md:128`. `?session=<id>` on the DevTool's address opens that session. `[doc]` `apps/docs/docs/devtool/overview.md:91-93`.
- **Shutdown.** `SIGINT` or `SIGTERM` prints `Shutting down...`, closes the servers, disposes the runtime, exits 0. `dev:642-667`.

### `fsdev serve`

Registered at `serve:37-45`. Flags: `-p, --port <port>`, `--host <host>`, `--config <path>`, `--dotenv <path>`, `--allow-unauthenticated`. No `--flow-dir`, no `--no-config`, no `--store`, no `--model`.

- **Needs a committed config.** With none, exit 3: `fsdev serve requires a committed fsdev.config.{ts,mts,js,mjs} in <cwd>. ... Create one, or pass --config <path>.` It checks this before importing any flow module. `rt:330-340`, `serve:81-95`, `sct:73`.
- **Port.** `--port` wins over `$PORT`; both must be all digits and 0 to 65535, else exit 3 `Invalid port: <value>`, and this is checked before the config loads. An empty `$PORT` counts as unset. Default 3000. `serve:65-79`, `sct:17-70`.
- **Host.** `--host` wins over `$HOST`. An empty `$HOST` counts as unset. Default `0.0.0.0`. `serve:97-102`, `sct:92-120,134`.
- **Authentication guard.** Before binding a non-loopback host, no served flow's effective resolver may be the framework default that trusts `body.userId`. The effective resolver is the flow's own `authentication.resolvePrincipal`, else the host-level `resolvePrincipal` given to `createFlowState` (`packages/engine/src/routes/network-auth.ts:44-58`, `packages/node/src/bind-guard.ts:11-16,83-88`). Otherwise exit 3. The three ways out: configure `resolvePrincipal`, bind a loopback host, or pass `--allow-unauthenticated`. Loopback binds skip the guard. `serve:1-13,107-123`, `sct:80`, `[doc]` `rdoc:185`.
- **Exit 3 also covers** a bind or listen failure (`EADDRINUSE`, `EACCES`) and a router that fails to initialise after the socket binds (`Server failed to initialize: ...`). `serve:113-123,150-160`, `sct:121`, `[doc]` `rdoc:187`.
- **What it mounts.** The flow API at `/api/flows` and the config's adapters (such as MCP). No static directory, so a non-API GET such as `/index.html` returns 404. `serve:104-112`, `[doc]` `rdoc:183`.
- **Startup output**, on stderr: `Server running at http://<host>:<port>`, `API:    http://<host>:<port>/api/flows`, `Config: <path>`. `serve:163-167`.
- **Shutdown.** `SIGINT`/`SIGTERM` print `Shutting down...`, drain, dispose, exit 0. `serve:125-140`, `[doc]` `rdoc:187`.
- **`devtool` config block** is ignored by `serve`. `[doc]` `cf:52`.

### `fsdev chat [flow] [action]`

Registered at `chat:43-57`. Flags: `-s, --session`, `-m, --model`, `-u, --user`, `--org`, `--flow-dir`, `--dotenv`, `--config`, `--no-config`, `--quiet`, `--log-level` (default `warn`). No `--store`, no `--capture`.

- **Positional arguments.** A flow instance id and an action: the pair `fsdev run` takes. They set the **default target**: where typed messages go. `chat:115-138`, `[doc]` `ic:13-18`.
- **How the runtime is found.** The same as `fsdev run`: a config in the working directory wins, else flows are discovered from `src/flows/` and `flows/` (and the monorepo folders, `--flow-dir`; section 4). `chat:151-156`, `[doc]` `ic:15`. With a config, `--flow-dir` exits 2. `chat:171`.
- **Default-target binding.**

  | Situation | Result | Cite |
  |---|---|---|
  | A flow (and action) named on the command line | Bound to it. Unknown flow exits 4. Unknown action exits 2. A flow with several actions and no action named exits 2: `Flow "<f>" has multiple actions: ... Specify one: fsdev chat <f> <action>`. | `chat:122-133`, `ch/targets.ts:448-468` |
  | Nothing named, config sets `chat: { default: "<flow>" }` or `"<flow>.<action>"` | Bound to it. A name that matches no flow, no action, or is ambiguous exits 3. | `chat:99-113,134` |
  | Nothing named, exactly one flow with exactly one action | Bound automatically. | `chat:136` |
  | Nothing named, several available | Starts unbound: `No default target bound. <n> targets available — /targets to list, /use <flow> to bind.` | `chat:315-317,137` |
  | No flows at all | Hard error, exit 4: `No flows found. Searched: ...` (discovery) or `No flow targets available to chat with.` (config). | `chat:196-202,225-227` |

  `[doc]` `ic:20-26`.
- **`--session <id>`** resumes a session for the initially bound flow. With no bound target it exits 2: `--session requires an initially bound target. Pass a positional flow (...), or bind one with /use and then /session <id>.` A session that belongs to a different flow, or has completed-request history from a different flow, is rejected with exit 2. `chat:262-282,287-309`, `[doc]` `ic:57`. A banner line says `(session <id>, resumed)`. `chat:310`.
- **Sessions.** Each flow gets its own session within a run, so history does not bleed across `/use`. Switching away and back resumes the first. `ch/state.ts:508-514,538-548`, `[doc]` `ic:53`.
- **Messages** are sent as `{ message: "<text>" }`. If the target's input schema rejects it, the turn fails with the validation error and the line `That target isn't chat-shaped (its action rejected { message }). Pick another with /use, or /targets to list them.` The session stays open. `ch/turn.ts:267-268,380-410`, `[doc]` `ic:30-32`. A turn is an ordinary in-process run of the action under the identity in section 6. `ch/turn.ts:377-388`.
- **Slash commands** (a line starting with `/`):

  | Command | Effect | Cite |
  |---|---|---|
  | `/help` | Lists the commands. | `ch/registry.ts:92-104` |
  | `/targets` | Lists `flow · action` targets; the default is marked `*`. | `ch/registry.ts:106-122` |
  | `/use <flow> [action]` | Switches the default target; prints `Now chatting with <flow> · <action> (session <id>, new\|resumed).` | `ch/registry.ts:124-148` |
  | `/status` | Prints `Target:`, `Session:`, `Turns:`, `Org:`, `Source:`, `Store:` lines. | `ch/registry.ts:150-169` |
  | `/session [new\|<id>]` | No argument prints the current flow's session id. `new` rotates it and resets history. An id binds that session, subject to the same guard as `--session`. A nonexistent id is allowed; the engine creates it on the first turn. Needs a bound target. | `ch/registry.ts:171-199` |
  | `/exit` | Leaves the session. | `ch/registry.ts:201-206` |

  Exit keys: `/exit`, Ctrl-D, and a double Ctrl-C when idle (the first Ctrl-C prints `(press Ctrl-C again or /exit to quit)`). During a turn, Ctrl-C aborts the turn and the loop stays up; the turn prints `(interrupted)`. `ch/loop.ts:1-12,66-68,98-113,199-207`, `ch/render.ts:375-378`, `[doc]` `ic:47`.
- **Unrecognised slash input.** A `/name [args]` that no built-in claims, where `name` is lowercase letters, digits and hyphens, at most 64 characters, starting with a letter or digit, is sent to the flow unchanged, slash included, when a target is bound. With no target bound it prints `No default target — pick one with /use <flow> [action] (see /targets).`. Any other line that starts with `/` (a lone `/`, uppercase, a path such as `/etc/hosts`) is not sent; it prints `type /help for commands`. A leading space sends a literal message that begins with `/`. `packages/core/src/helpers/slash-command.ts:19`, `ch/parse.ts:28-42`, `ch/targets.ts:479-496`, `ch/loop.ts:119-129`, `[doc]` `ic:36-49`.
- **Live status line.** A transient status an in-flight block reports updates in place on one line and clears when real output (reply text, a tool call, a system line) arrives. It is drawn only when the session's input is an interactive terminal; with piped input it is skipped, silently. A non-transient status prints as its own line. `ch/render.ts:222-235,322-334`, `[doc]` `ic:34`, `[test]` `chat-render.test.ts`.
- **What it prints.** Assistant text streams as it arrives; a tool call prints `· tool call: <name>`; an error prints `· error: <message>`; a persistent status prints `· status: <message>`. Reasoning, traces and the user-message echo are not printed. `ch/render.ts:263-276,318-366`.
- **A turn that stops for a person** prints `Waiting for a person: <what> (suspension <id>). <where to answer>`. The session stays open. `ch/turn.ts:395-403`, `[doc]` `ic:53`.
- **Where history is stored.** Without a config, `.fsdev/data/fsdev.db` (SQLite), the file `fsdev run` and `fsdev dev` share; the DevTool lists chat sessions run as the same user. With a config, the app's own stores. `/status` shows `Store: .fsdev/data/fsdev.db (SQLite)` or `Store: app-configured stores`, and `Source: discovery` or `Source: config (<path>)`. `chat:195-217,187`, `[doc]` `ic:53`.
- **Exit codes.** Startup failures use 2, 3 and 4 as above. A failed turn never ends the loop. In piped (non-interactive) mode, the process exits **1** if any turn failed or any built-in refused (including a message sent with no bound target); on an interactive terminal it exits 0 on `/exit`, Ctrl-D or the double Ctrl-C. `ch/loop.ts:124-137,235-238`, `[doc]` `rdoc:238`.
- **Dispose.** On exit, a config's `FlowState` is disposed, or the opened SQLite store is closed. `chat:188-194,346`. `[doc]` `ov` says chat waits for in-process background work when you leave the session, not at the end of each turn (`ov:101-102`).

### `fsdev gen`

Registered at `gen:357-364`. Flags: `--root <dir>`, `--check`.

- **What it does.** Runs the code generator one of the app's dependencies supplies, and writes the one file that generator renders. The command knows no convention. `gen:1-18`, `rd` fsdev gen section.
- **What it reads.** The `package.json` nearest the working directory (the working directory or the closest folder above it), and its `dependencies` and `devDependencies`, looking for a package that exports a `./fsdev-gen` subpath. Run it from the app's folder. `gen:248-264,276-283,329`.
- **Exactly one generator must exist.** None: exit 3, `No dependency in <package.json> exports a generator on "./fsdev-gen".` More than one: exit 3, names them. A package whose `./fsdev-gen` export lacks a `generator` with `defaultRoot` and `generate`: exit 3. No `package.json`: exit 3. `gen:269-309`, `[doc]` `rd` fsdev gen "Finding the generator".
- **The generator is the only code it loads.** Not `fsdev.config.ts`, not any file under the root. `gen:7-12`.
- **`@flow-state-dev/workforce`** is the generator Workforce apps use: the app must list it in its `package.json` dependencies. It reads the `workforce/` folder (default root `workforce`, resolved from the working directory) and writes `workforce/workforce.gen.ts`, a module of static imports. `packages/workforce/package.json:53-55,96-99`, `packages/workforce/src/codegen/fsdev-gen.ts:68-73`, `packages/workforce/src/codegen/render.ts:26`, `[doc]` `apps/docs/docs/workforce/code-on-disk.md:67-70`.
- **`--root <dir>`** sets the directory the generator reads, relative to the working directory. Default: the generator's own `defaultRoot`. The file is written under that root. `gen:330-332`, `[doc]` `rd`.
- **Output** on success: `Looked in: <dirs>`, one line per registration (`<path> -> <name>`), then `Wrote <file> (<summary>).` or `<file> unchanged (<summary>).` `gen:404-410`.
- **`--check`** writes nothing. Exit 0 and `<file> is up to date (<summary>).` when the committed file matches. When it does not: exit **1**, and stderr says `<file> is out of date. Run \`fsdev gen\` and commit the result.` then `The tree holds <summary>:` and every discovered path. `gen:384-401`, `[test]` `gct`.
- **Comparison ignores CRLF versus LF.** Writes are always LF. `gen:344-350`.
- **A symlink at the generated file's path is refused** (exit 3), for write and for `--check`. `gen:339-342,377-379`, `[doc]` `rd`.
- **Exit codes:** 0 written, unchanged, or `--check` current. 1 when `--check` finds it stale, or when the generator refuses the tree (an error carrying a `problems` array). 3 for any other failure. `gen:312-315,377-379,400,415`, `[doc]` `rd` fsdev gen "Exit codes".
- **CI.** Run `--check` as its own step; inside a build script that already ran `fsdev gen` it would always pass. `gen:184-186`, `[doc]` `apps/docs/docs/workforce/code-on-disk.md:129-139`.
- **Writing a generator**: export `generator` (`FsdevGenerator`: `defaultRoot: string`, `generate(root): Promise<GeneratedModule>`) from the package's `./fsdev-gen` subpath. `generate` must not write. `GeneratedModule` has `file`, `content`, `searched`, `entries`, `paths`, `summary`. `gen:200-228`, `idx:26-27`.

### `fsdev ui add <components...>` and `fsdev ui list`

Registered at `ui:51-129`.

| Command | Flags | Behavior | Cite |
|---|---|---|---|
| `ui add <components...>` | `--registry <url>` (default `https://ui.flow-state.dev/r`), `--cwd <dir>` (default the working directory) | Calls `npx shadcn@latest add <registry>/<name>.json ...` once for all components named, with the working directory set. Prints `Installing <names>...`. Exit 0 on success, 1 and `Failed to install <names>.` otherwise. A local `--registry` path resolves `<path>/<name>.json`. | `ui:13,56-85` |
| `ui list` | `--registry <url>`, `--category <cat>` | Prints the registry's component names and descriptions: `<registry name> — <n> component(s)`. `No components found.` when the filter matches nothing. Exit 3 with `Could not load registry manifest.` when the manifest cannot be fetched (for a URL, `Check your network connection.`; for a path, `File not found: <path>/index.json`). | `ui:87-128` |

- **The direct URL.** The same install without the CLI: `npx shadcn@latest add https://ui.flow-state.dev/r/<name>.json`. `ui:13,62-66`, `packages/ui/README.md:16-17`, `[doc]` `ui-ov:20-21`.
- **Where files go.** Components are copied into `components/flow-state/` in the project and become the project's own source. `[doc]` `ui-ov:11`.
- **The `tokens` item.** A registry item (`registry:theme`) that holds every colour token the registry's components read, light and dark: the semantic set plus the status tokens `success`, `warning`, `info` and `attention`, each with a `-foreground`, plus `destructive`. Defaults sit in a base layer, so an app's own values win. It is listed as a registry dependency of every component that reads a status token, so it is added with the first such component; `fsdev ui add tokens` also works. `ui-reg:7-10,184,349,375`, `ui-tok:1-61`, `[doc]` `ui-ov:29-49`, `packages/ui/README.md:25`.
- **Default colours** (light): `success` green (hsl 142 76% 36%), `warning` amber/orange (hsl 32 95% 44%), `info` blue (hsl 217 91% 60%), `attention` yellow (hsl 41 96% 40%), `destructive` red (hsl 0 84.2% 60.2%). Dark values are separate in `.dark`. `ui-tok:22-29,17,48,53-60`, `[doc]` `ui-ov:43` ("green, amber, blue, yellow and red").

### `fsdev worktrees <root>`

Registered at `wt:229-243`. Flags: `--repo <path...>`, `--remove <dir>`, `--delete-branch`, `--force`, `--json`.

- **Listing** (the default): one line per worktree: `clean`, `dirty` or `gone` (its directory is missing), then the branch (`(detached)` for a detached HEAD), then the directory. `No worktrees.` when none. `--json` prints an array of listed worktree objects instead, with `{ place, dir, cwd, repository, branch, head, dirty }` per `[doc]` `rdoc:312`. `wt:184-193,220-221`.
- **Where it looks.** Every clone under `<root>`, every repository a host on that root listed (from pin files in `<root>/.fetch-pins/`), and any `--repo`. `wt:150-182,196-207`, `[doc]` `rdoc:302`.
- **`--remove <dir>`** removes that worktree. `--delete-branch` deletes its branch too. `--force` (with `--delete-branch`) deletes a branch holding the only copy of some commits. Success prints `Removed <cwd>` and one of `.`, ` and deleted branch <b>.`, or `; branch <b> kept.`. `wt:209-219`.
- **Refusals.** The host's `remove` refuses a worktree with uncommitted or untracked changes, one still being set up, one a run is working in (`in-use`), and, with `--delete-branch` and no `--force`, a branch holding commits no other branch or remote holds. A refusal removes nothing, prints `Refused (<reason>): <message>` and exits 1. `wt:223-226`, `[doc]` `rdoc:314`.
- **Exit codes:** 0 success, 1 on a refusal or other failure, 2 when `<root>` does not exist (`<root> does not exist.`). `wt:197-200,222,226`.
- **Imports** `localWorkspaceHost` from `@flow-state-dev/workspace`. `wt:147`.

### `fsdev benchmark <file>`

Registered at `bench:241-269`. Flags:

| Flag | Meaning |
|---|---|
| `-m, --model <model>` | Override the executor model for all subjects. |
| `--judge-model <model>` | Override the judge model. |
| `--runs <n>` | Repetitions per (subject, task). Positive integer. |
| `--concurrency <n>` | Concurrent (subject, task, run) cells. Positive integer. |
| `--category <name>` | Only run tasks in this category. Exit 2 if none match. |
| `--patterns <names>` | Comma-separated subset of pattern names. |
| `--baseline-model <model>` | Add a pure-model baseline. Repeatable. The run model is always included. |
| `--no-baseline` | Skip every baseline subject, including the pure-model baselines `--baseline-model` adds (`bench:127-131`, `packages/testing/src/benchmark/index.ts:109-117`). |
| `--max-cost <usd>` | Abort the sweep when the estimated cost exceeds this. Positive number. |
| `--search` | Force provider-native web search on, overriding the definition's `disableSearch`. |
| `--output <path>` | Write the scorecard to a file instead of stdout. |
| `--dotenv <path>` | Load a `.env` file. Repeatable. |
| `--format <format>` | `table` (default), `markdown` or `json`. Anything else exits 2. |

`bench:36-78,244-266`. Exit 1 when `--max-cost` is exceeded and the sweep stops (a partial scorecard prints); exit 0 otherwise. `bench:262-263`, `[doc]` `rd` fsdev benchmark. The existing README table omits `--search` and `--dotenv`; the registration has them. Narrative stays in the benchmarks docs (`apps/docs/docs/testing/benchmarks`); the Reference row links there.

## 4. Flow discovery (without a config)

Used by `run`, `chat`, `dev` when no config loads (none present, or `--no-config`).

- **Where it looks**, relative to the working directory: `src/flows/` and `flows/`; then, one level under each of `packages/`, `examples/`, `apps/` and `labs/`, the `src/flows/` and `flows/` of each subfolder (`packages/*/src/flows/`, `packages/*/flows/`, `examples/*/...`, `apps/*/...`, `labs/*/...`). `rf:31-38,96-118`, `[doc]` `rdoc:316-338`.
- **What it loads.** Inside a flows folder: each subfolder that has `flow.ts`, `flow.js`, `index.ts` or `index.js` whose default export looks like a flow (a `kind` string and an `actions` object); and each `.ts` or `.js` file directly in the folder. A module that imports fine but is not a flow is skipped silently. `rf:19-29,165-204`.
- **`--flow-dir <path>`** (repeatable) replaces that search with only the folders given (absolute, or relative to the working directory). `rf:90-95`, `[doc]` `rdoc:340-350`. With a config it exits 2: `--flow-dir bypasses fsdev.config.*; pass --no-config to use directory discovery.` `rt:370-377`.
- **Duplicates.** Flows are de-duplicated by instance id, first found wins. `rf:72-86`.
- **A module that throws on import** is reported on stderr as `Warning: failed to import flow module: <path>` plus the indented message, and the scan continues. A "not found" error then lists the modules that failed. `rf:41-48,175-203,255-263`, `rt:352-354`, `[test]` `discovery-import-failures.test.ts`, `[doc]` `rdoc:352-363`.
- **Programmatic exports** (`@flow-state-dev/fsdev`, `idx:5-48`): `program`, `resolveBlock`, `isBlockDefinition`, `resolveFlow`, `discoverFlows`, `getSearchedDirs`, `isFlowInstance`, `loadFsdevConfig`, `locateConfig`, `declaredDevtoolConfig`, `parseInputArg`, `formatOutput`, the `EXIT_*` constants, `executeDevCommand`, `registerDevCommand`, `DEVTOOL_URL_META`, `executeGenCommand`, `resolveGenerator`, `GENERATOR_SUBPATH`, `registerGenCommand`, `executeServeCommand`, `registerServeCommand`, `executeChatCommand`, `registerChatCommand`, `registerUiCommand`, `executeWorktreesCommand`, `registerWorktreesCommand`, `CANONICAL_NEXT_STEPS`, `renderNextSteps`, `assertCanonicalNextSteps`; types `FlowRunResult`, `FlowEvent`, `BlockExecResult`, `DiscoverFlowsOptions`, `FlowImportFailure`, `LoadConfigOptions`, `LoadedConfig`, `DevCommandOptions`, `DevServer`, `GenCommandOptions`, `GenResult`, `FsdevGenerator`, `GeneratedModule`, `ChatCommandOptions`, `ParsedInput`, `FlowActionTarget`, `ChatRenderer`, `WorktreesCommandOptions`. `discoverFlows(cwdOrOptions)` takes a string (cwd) or `{ cwd, flowDirs, onImportFailed }`; each `FlowImportFailure` carries `filePath`, `message`, `cause`. `resolveFlow(specifier)` and `resolveBlock(specifier)` take a file path. `rf:50-61,75`, `[doc]` `rdoc:367-434`. The page may keep this as a short "From a script" table or leave it to the API reference; the plan names tables for commands, config and output formats only.

## 5. The config file

- **Name and search.** `fsdev.config.ts`, `fsdev.config.mts`, `fsdev.config.js`, `fsdev.config.mjs`, in that order, in the working directory only. It does not walk up. If more than one exists, the first wins and stderr prints `Warning: multiple fsdev config files found; using <a>, ignoring <b>`. `lc:106-112,145-170`, `[doc]` `cf:19-28`.
- **What it must export.** A `FlowState` (the object `createFlowState()` returns) as the default export. Otherwise exit 3: `fsdev config <path> must default-export a FlowState — <no default export | the default export is a <type>, not a FlowState>.` `Expected: export default createFlowState({ ... })`. `lc:197-209`, `[doc]` `cf:30-48`.
- **`--config <path>`** names the file and skips the search. Relative paths resolve against the working directory. A missing file exits 3: `Config file not found: <path> (resolved to <abs>)`. `lc:148-157`.
- **`--no-config`** ignores any config and uses directory discovery. `rt:322-324`. `fsdev serve` has `--config` but not `--no-config`; it has no discovery. `serve:26`, `[doc]` `cf:211`.
- **A config that does not load** (throws on import, or the module cannot be imported) exits 3: `Failed to load fsdev config <path>: <message>`. `lc:187-195`.
- **When a config loads**, the registry, the store profiles and the model resolver all come from your `FlowState`; the CLI adds only its own stderr logger. `--flow-dir` is refused. `rt:370-377`, `run:274-302`, `[doc]` `cf:101-115`.
- **`chat.default`** on `createFlowState` binds a bare `fsdev chat` to `"<flow>"` or `"<flow>.<action>"`. `chat:186,99-113`, `[doc]` `ic:25`.
- **`devtool: { userId?, bearerToken? }`** on `createFlowState`: only `fsdev dev` reads it. `userId` sets the identity the DevTool acts as; `bearerToken` is sent as `Authorization: Bearer`. Handed to loopback pages only; `serve` ignores it. A blank block counts as unset. `dev:357,359-370`, `devtool-config.ts:9-25`, `[doc]` `cf:50-52`.
- **How a `.ts` config is loaded.** A native import is tried first; when Node cannot load the file (extensionless relative imports, `tsconfig` path aliases such as `@/flows/chat/flow`, a Node without type stripping, TypeScript that stripping cannot erase), it is loaded through `jiti`, which resolves the app's `compilerOptions.paths`. `.js` and `.mjs` configs are always a plain import. `icm:6-15,29-35,46-59`, `[test]` `lct:100-135`. See "Contradictions found": the existing config page says aliases fail and `.ts` needs Node 22.18; the code and test say otherwise.
- **Every load evaluates the file fresh** (cache-busted), so repeated loads in one process get separate `FlowState` objects. `icm:41-47`.
- **Environment files** (before the config is imported, so the config's providers see the keys). Highest precedence first: (1) the real shell environment, never overwritten; (2) files named by `--dotenv`, in the order given; (3) `.env.local` in the working directory, then each parent up to the filesystem root. The first source to set a key wins. The walk-up only climbs, so a monorepo root does not pick up `apps/my-app/.env.local`. A file named with `--dotenv` that does not exist exits 3: `--dotenv file not found: <path>`. A `.env.local` found by the walk-up that cannot be read is skipped silently. Parsed forms: `KEY=VALUE`, `KEY="quoted"`, `KEY='quoted'`, `#` comment lines, blank lines. `le:1-12,244-285,292-346`, `rt:309-316`, `[doc]` `cf:54-79`, `[test]` `load-env.test.ts`.
- **The file the config's app also exports.** A server entry can re-export the same `FlowState` so the CLI and the server share one object. `[doc]` `cf:81-99`. (This is an example for another page; the Reference row is one sentence.)

## 6. Who a run is (identity flags)

`fsdev run` and `fsdev chat` ask the app who the caller is, the way an HTTP action request is asked, then run as that user in that organization.

- **Resolver precedence.** The flow's own `defineFlow({ authentication: { resolvePrincipal } })` when it has one, else the `resolvePrincipal` given to `createFlowState`. The resolver sees `source: "cli"`, no `request`, and no credential. `pr:1-11,133-160`, `[doc]` `cf:117-135`. The `cli` source is produced only by `run` and `chat`; a transport that stamps it is refused before the resolver runs. `[doc]` `cf:125-127`.
- **Defaults.** No resolver anywhere, or no config at all (discovery, `--no-config`): user `devuser`, organization `DEFAULT_ORG_ID` (the string `__fsd_default_org__`). `pr:25-31`, `packages/core/src/types/auth.ts:39,47`, `[doc]` `cf:135-139`. A configured resolver that returns `DEFAULT_ORG_ID` is refused. `[doc]` `cf:137-139`.
- **`-u, --user <id>`** replaces only the user. The organization still comes from the resolver. A blank `--user` exits 2: `--user must be a nonempty user id.` Default user: the one the app's resolver returns, or `devuser` when the app has no resolver or `--org` is passed. `pr:98-100,139-159`, `[doc]` `rdoc:32`.
- **`--org <id>`** skips the resolver and runs as `--user`, or `devuser`. It must be a nonempty, well-formed id (not a lone UTF-16 surrogate, not blank) and not `DEFAULT_ORG_ID` (the reserved development organization), else exit 2: `--org must be a nonempty, well-formed organization id.` or `--org "__fsd_default_org__" is the reserved development organization; omit --org to use it on an app with no resolver.` `fsdev serve` and `fsdev dev` have no such flag. `pr:85-101,140-142`, `[doc]` `cf:158-159`.
- **A resolver that wants a credential** refuses the terminal (it throws, or returns `null`, which names no user or organization). The run stops before writing anything and exits **2**: `Flow "<f>" refused this terminal: <reason>` then `The CLI carries no credential, so a resolver that checks one refuses it. Pass --org <id> to name the organization yourself. Nothing was written.` `pr:143-154`, `[doc]` `cf:141-156`. On `chat` it fails that turn only. `ch/loop.ts:164-173`.
- **A flow pinned to an owner** (a hired worker) refuses any identity outside its pin, before anything is written, exit 2: `Flow "<f>" refused this terminal: it runs only for the owner it is pinned to, and this run is <u> in <o>. Pass --org <id> and --user <id> naming its owner. Nothing was written.` `pr:114-129`.
- **A session keeps the user and organization it was created with.** Resuming it as anyone else exits 2 (`run`) or fails the turn and rotates to a fresh session (`chat`): `Session "<id>" belongs to user <u> in organization <o>; this run is <u2> in <o2>. Nothing was written. A session keeps the user and organization it was created with; use a new session id.` A session with no organization recorded is refused with the engine's upgrade message. `pr:188-203`, `ch/loop.ts:176-184`, `[doc]` `cf:165-173`.
- **Seeing who a run was.** Unless `--quiet`, `fsdev run` prints one stderr line before the action: `[fsdev] running as <user>[ (named by --user)] in organization <org> (<named by --org | no resolver configured | from the app's resolver>)`. `pr:166-175`, `run:414`, `[doc]` `cf:175-181`.
- **`--capture`** records the identity under `command.principal` as `{ userId, orgId, from }`; `from` is `resolver`, `flag` or `development-default` and describes the **organization** only. Whether `--user` named the user shows only on the stderr line. `pr:32-46`, `run:196-209`, `[doc]` `cf:183-190`.
- **`fsdev chat`** asks per turn, for that turn's target. `/status` prints `Org: <org> (user <u>, <from>)` for the current target's last turn, or `Org: (asked on each turn)` before its first turn. `chat:329-336`, `ch/registry.ts:159-164`, `ch/state.ts:516-519`.
- **Pairs with `--session`.** `--session` resumes a session; `--user` and `--org` say who. The identity check above applies to every `--session`.

## 7. Output formats and exit codes

### Where output goes

- **stdout** carries the command's result: NDJSON for `run`, one JSON document for `block`, the transcript for `chat`, the scorecard for `benchmark`, the listing for `worktrees` and `ui list`. stderr carries logs, notices and errors. The CLI installs its own stderr logger so engine logging never lands on stdout. `rt:416-447`, `[test]` `rct:398-407`.
- **`--quiet`** on `run` silences the `[flow-state] ...` runtime logs, the `[fsdev] running as ...` line, the waiting report, and the missing-config hint. It does not silence a shutdown report about work given up on, or a `--capture` write failure. `run:414,575,591,597`, `[doc]` `ov:70,99`, `rd` stderr logs.
- **`--log-level`** `debug` additionally logs `nested block started`, `nested block completed` (blocks run inside sequencers and routers) and `router selected route` lines, as stderr log lines. They are not NDJSON events. `packages/engine/src/context/createExecutionContext.ts:3754,3765,3805`, `[doc]` `adl:50,66`, `rd` stderr logs. Default level: `info` for `run`, `warn` for `chat`. `run:510`, `chat:244`. A log line is `<message> <JSON context>`, each value shortened to 240 characters. `rt:388-447`.

### `fsdev run` stdout: NDJSON

One JSON object per line, each with a `type`, in the order things happen. `run:56-65,94-97,697-746`.

| `type` | Fields | When |
|---|---|---|
| `item_added` | `item` | A new output item (message, reasoning, tool call, ...). |
| `item_updated` | `itemId`, `patch` | A patch to an existing item. |
| `item_done` | `item` | An item reached its final state. |
| `content_delta` | `itemId`, `delta` | An incremental chunk of a streaming item. |
| `state_change` | `scope`, `resourcePath`, `changeType` | A scope's state or a resource changed. |
| `flow_complete` | `output`, `durationMs`, `items` | The action finished. Last line. `output` is `null` when the action returned nothing. |
| `suspended` | `requestId`, `sessionId`, `suspensionId`, `reason`, `title?`, `message?`, `answer` | The run is held, waiting for a person. Last line. `answer` is one sentence saying where to answer it. |
| `error` | `message` | The action failed. Last line. |

- **Exactly one terminal event per run that reaches the engine**: `flow_complete`, `suspended` or `error`. `run:572-587`. A failure before the engine runs (unknown flow, unknown action, bad input, a refused identity, a refused seed, a bad config) prints its message on stderr, exits non-zero, and emits no event. `run:154-158,289-296,350-357`.
- **Exit code:** 0 on `flow_complete` and on `suspended`; 1 on `error` (`run:605`). A run that is `suspended` is not finished.
- **`--capture <path>` file:** `{ command: { flow, action, input, model, session, seedSession, principal }, events: [every NDJSON event, in order], result: { success, flow: { kind, action }, output, execution: { durationMs, itemCount }, error?: { message, stack?, code? }, suspended?: <the suspended event's fields>, exitCode } }`. Unset values are `null`. `--capture` holds the command, its events and its result, not session or resource state. `run:195-209,596-629`, `[doc]` `rdoc:87`.
- **The waiting report** on stderr, when a run ends `suspended` (unless `--quiet`):

  ```
  [fsdev] waiting for a person: <message, else title, else reason>
  [fsdev]   suspension <id> · request <id> · session <id>
  [fsdev]   <where to answer it>
  [fsdev]   Its deadline fires only while a server runs on this store.
  ```

  `run:682-691`, `[doc]` `rdoc:72-83`. The "where to answer it" sentence is `Answer it in fsdev dev, which reads this store: .fsdev/data/fsdev.db (SQLite).` (default store), `Answer it in fsdev dev --store filesystem, started after this run exits: ... Its state is under .fsdev/data (filesystem, single-process).` (`--store filesystem`), or `Answer it in a server on this app's stores, such as fsdev dev with <config path>.` (config). `run:302,331-335`. A suspension's deadline passes unnoticed until a server runs on the same store; a server that starts later expires it as soon as it is up. `[doc]` `rdoc:81`.
- **`--store filesystem`** also prints `[fsdev] store: .fsdev/data (filesystem, single-process). It is single-process: don't run fsdev dev on it while this run is going.` to stderr (unless `--quiet`). `run:336-340`.

### Other commands' output

| Command | Output | Cite |
|---|---|---|
| `block` | One JSON document (section 3). | `block:136-154` |
| `chat` | A plain-text transcript, section 3. | `ch/render.ts` |
| `dev`, `serve` | Banner lines on stderr (section 3). Nothing on stdout. | `dev:602-614`, `serve:163-167` |
| `gen` | Plain text lines (section 3). | `gen:384-410` |
| `benchmark` | The scorecard on stdout, or in `--output <path>`, as `table`, `markdown` or `json`. A `table` has subjects in rows, categories plus `overall` in columns, `mean±stddev` of the judge score (0 to 1) in each cell. | `bench:259,266`, `[doc]` `rd` fsdev benchmark |
| `worktrees` | One line per worktree, or JSON with `--json`. | `wt:184-193,221` |
| `ui list` | A header line and one line per component. | `ui:118-125` |

### Exit codes

Constants exported from `@flow-state-dev/fsdev` (`idx:14-22`, `ex:56-62`, `[test]` `ect:13-20`):

| Code | Name | Where the commands use it |
|---|---|---|
| 0 | `EXIT_SUCCESS` | Success. Also `run` ending `suspended`. |
| 1 | `EXIT_EXECUTION_ERROR` | `run` ended `error`; `block` threw; `gen` found a stale file (`--check`) or the generator refused the tree; `worktrees` refused or failed; `ui add` failed; `benchmark` stopped over `--max-cost`; `chat` in piped mode after a failed turn or built-in. |
| 2 | `EXIT_INVALID_ARGS` | Bad JSON input or both `-i` and `-f`; unknown action; unknown `--log-level`; bad `--store`; `--store` or `--flow-dir` or `dev --model` with a config; bad `--org` or `--user`; a run whose identity or session was refused; a refused seed; `chat --session` with no bound target; `worktrees` with a missing root; `benchmark` bad numeric flag or `--format`. |
| 3 | `EXIT_CONFIG_ERROR` | Config not found, not a `FlowState`, or fails to load or initialise; a named `--dotenv` file missing; an invalid port; a bind or listen failure; the `fsdev serve` guard; `dev --watch` on a non-loopback host; DevTool assets not found; `--app` problems; `gen` setup problems; a `chat.default` that names nothing; `ui list` with no manifest. |
| 4 | `EXIT_DISCOVERY_ERROR` | Flow not found, or no flows found; block file not found, not importable, no default export, or not a block; a `benchmark` file that cannot be imported (`Cannot load benchmark file`). A `benchmark` file with no `defineBenchmark` default export, no registry for pattern names, or neither `subjects` nor `patterns` exits 2 (`bench:149-166,198-212`). |
| 5 | `EXIT_SCAFFOLD_ERROR` | Exported, and no command in the package uses it. Leave it out of the table, or list it as unused. |
| 10 | `EXIT_INTERNAL_ERROR` | An unhandled exception: `Unexpected error: <message>` on stderr. |

Sources for the 2 column: `parse-input.ts:33-72`, `rt:376,463`, `ls:158-165`, `pr:88-100,121-127`, `run:354,385-409`, `chat:290-294`, `wt:200`, `bench:62-76,106-110`. For 3: `lc:151-209`, `le:340`, `dev:171,179-185,346-349,359-381,590-598,710-715`, `serve:77,94,113-123,153-160`, `da` (every `EXIT_CONFIG_ERROR`), `gen:270-308,378`, `chat:107-111,177-180`, `ui:101`. For 4: `rt`/`run:292,311`, `chat:127,201,226`, `rb:57-80`, `dev:388`. For 1: `run:605`, `block:155`, `gen:378,400`, `wt:222-226`, `ui:80`, `bench:262-263`, `ch/loop.ts:237`.

`[doc]` `rdoc:436-445` has the old table. It omits 5, calls 3 "invalid port, missing devtool assets" (too narrow), and 4 "flow or block not found, import failed". See "Contradictions found".

## 8. What the CLI stores

The CLI itself keeps no registry or database of its own. These are the stored parts it creates, each answered on four questions.

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
|---|---|---|---|---|
| **Sessions and requests from `run` and `chat`** (state, items, held suspensions), no config | The user and organization the run was made as; a session keeps the identity it was created with and refuses anyone else (`pr:188-203`). Default user `devuser`. | `fsdev dev` started in the same folder lists them for the DevTool's user, `devuser` unless `devtool.userId` says otherwise. A different user cannot resume them. | `.fsdev/data/fsdev.db` (SQLite) under the working directory the command ran in, or JSON files under `.fsdev/data` with `--store filesystem`. The two stores do not see each other's sessions. `ls:105-139,170-183`, `[doc]` `rdoc:85-89`. | One database file per working directory. One session per `--session` id; without `--session`, `run` mints a new session per invocation. `chat` keeps one session per flow within a run; `/session new` rotates it. `run:374`, `ch/state.ts:508-548`, `ch/registry.ts:184-189`. |
| **The same, with a config** | As above, in the app's own stores. | Whatever reads the app's stores, such as a server on the same config. | The store profile the config declares. In-memory profiles persist nothing. `[doc]` `cf:101-115`, `rdoc:83`. | As the app's stores hold. |
| **A `--capture` file** | Whoever ran the command. | Anyone who can read the path. | The path given, relative to the working directory, parent folders created, overwritten on each run. `run:211-220`. | One file per `--capture` path. |
| **The generated module from `fsdev gen`** | The app: commit it. | Anyone with the repo. | `<root>/<file>`, e.g. `workforce/workforce.gen.ts`. `gen:332`. | One per generator per app. Rewritten only when its content changes. `gen:352`. |
| **Components from `fsdev ui add`** | The project: they are copies, edit them freely. | Anyone with the repo. | `components/flow-state/` in the project. `[doc]` `ui-ov:11`. | One file set per component added. |
| **The `tokens` stylesheet entries** | The project. | Anyone with the repo. | The project's stylesheet. `ui-reg:7-10`. | One set of light and dark values. |

`fsdev worktrees` creates nothing; it lists and removes what a workspace host made. `wt:1-14`.

## 9. The `shift-manager` command

A separate binary, `shift-manager` (`packages/shift-manager/package.json` `bin`), from `@flow-state-dev/shift-manager`. It is a thin wrapper over `fsdev dev`'s app hook with Shift Manager as the app: one process serves the Lab's API under `/api/flows`, Shift Manager's pages, and the DevTool on a port of its own. `sm:1-32`, `smr` Run it.

| Flag | Default | Meaning | Cite |
|---|---|---|---|
| `--config <path>` | `fsdev.config.*` in the directory the command was typed in | The Lab's config. A relative path resolves from there. None found exits 3: `No fsdev config in <dir>. Pass --config <path to the Lab's fsdev config>.` | `sm:93,108-114` |
| `--port <n>` | `4300` | `0` picks a free port. | `sm:94`, `smr` |
| `--host <host>` | `127.0.0.1` (fsdev's default) | A non-loopback host is refused unless the Lab authenticates requests, and always refused when the Lab hands its page a bearer token. | `sm:95`, `dev:359-381`, `smr` |
| `--shift <day\|evening\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on that theme. An unknown name exits 3 and lists the known ones. | `sm:46,72-86,96` |
| `--dev` | off | Restart the Lab when a file it loaded changes, `WORKER.md` included, and reload the page. Loopback only. A restart is a new process, so a Lab with in-memory stores starts empty each time. | `sm:98,123`, `smr` "While you edit your Lab" |
| `--assets <dir>` | the built pages in the package | Serve a different build of the pages as is. This is `fsdev dev --app <dir>` under another name. | `sm:16-18,97,125` |
| `--no-open` | opens the browser | Don't open the browser. | `sm:99,124` |

- **Unknown flags and positional arguments** exit 3 with the parser's message. `sm:91-106`.
- **Paths resolve from where the command was typed** (`INIT_CWD` when set by npm or pnpm, else the working directory), and the process runs there, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`. `sm:24-27,108,117`, `smr`.
- **Node 22 or later.** `packages/shift-manager/package.json` `engines`.
- **Without the DevTool package installed**, Shift Manager still starts and turns *Open trace* off. `smr`.
- The `--shift` themes and the `shift-manager-theme` meta are Shift Manager page behavior; leave them to the Shift Manager catalog page.

## 10. Contradictions found (code against existing docs)

Each is a place where an existing page states something the code does not. The page follows the code.

1. **A `.ts` config's loading requirements.** `cf:191-201` says a `.ts` config needs Node 22.18 or tsx, that `tsconfig` path aliases break it, and that on earlier 22.x it will not load. The loader falls back to `jiti` whenever Node cannot load the file, including extensionless imports, path aliases and no type stripping. `icm:6-15,46-59`, `[test]` `lct:100-135`. State the code.
2. **`rdoc` omits flags the code has.** `fsdev run`: `--quiet`, `--log-level`, `--capture` (`run:146-148`) are in `rd` and `adl:60-66` but not in `rdoc:25-38`. `fsdev ui`: `--registry`, `--cwd`, `--category` (`ui:59-60,89-90`). `fsdev benchmark`: all flags except as `rd` lists them, and `--search` and `--dotenv` are in neither. `fsdev gen` is absent from `rdoc` and `ov:11-23`. `fsdev block --format` accepts only `json`.
3. **Exit code 3 and 4 are broader than `rdoc:443-444` says** (section 7). Exit code 5 exists as a constant and no command emits it.
4. **`rb` doc comment says exit 2 for a missing default export or a non-block.** The code and tests give 4 (`rb:70-81`, `resolve-block.test.ts`).
5. **`ic:51-53`** says history persists in the same SQLite database "in the discovery path" and says nothing for a config; the code uses the app's stores with a config. State both.

## 11. Plan rows (the 32 rows other passes moved here)

`grep -rhE --include=*.record.md -e '→ R-35( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` returns 32 rows, from 13 records. Each is a claim; each is checked below.

Carried as stated (true):

1. `fsdev ui add <component...>`, `fsdev ui list`, the direct shadcn URL. Section 3, `ui:13,56-90`.
2. The `tokens` item: written with the first component that uses a status token, every token light and dark, default colours. Section 3, `ui-reg:7-10`, `ui-tok`. Not strictly "written automatically on first add of a component that uses a status token": it is a registry dependency of those components, so shadcn adds it when missing (`ui-reg:184,349,...`); `fsdev ui add tokens` also works. Carried with that wording.
3. Shift Manager default address and port 4300, Node 22 minimum. Section 9. **Corrected:** "loopback-only serving" is the default bind (`127.0.0.1`), not a rule: a non-loopback `--host` is allowed when the Lab authenticates and refused otherwise (`smr`, `dev:359-381`). `--dev` is the loopback-only flag.
4. Shift Manager flags: `--config` lookup order and the no-config refusal; `--dev` restart trigger and that a restart resets in-memory stores. Section 9. True. The "lookup order" is the `fsdev dev` order `fsdev.config.ts`, `.mts`, `.js`, `.mjs` (`lc:107-112`).
5. `fsdev gen`: what it reads, writes, the `@flow-state-dev/workforce` dependency, run-from folder, `--check` exit code. Section 3. True. "Run-from folder": the folder whose nearest `package.json` lists the generator and whose `workforce/` folder (the default root) sits beneath it; both come from the working directory (`gen:329-330`).
6. `fsdev gen --root`. Section 3.
7. `fsdev dev` startup: what it builds, single process, banner lines `App:` and `DevTool:`, default port 4200, localhost-only binding. Section 3. True; "localhost-only" is the default bind, and `--host` can change it with a config (`dev:130,373-381`).
8. DevTool address on the banner and the `not served` state. Section 3. True (`dev:608,497-506`). "Until assets are built" is accurate: `resolveDevToolAssets` also checks the monorepo `dist` folders (`dev:689-716`), so the state is "package not installed and no built assets".
9. `fsdev run` output contract: events on stdout, logs on stderr, one terminal event, exit 0 or 1. Section 7. True, with two additions: a failure before the engine runs emits no event, and `suspended` exits 0. The cut sentence about running in the same process on the production engine is not on this sheet, per the row's instruction.
10. `fsdev block` arguments, output document, default-export rule. Section 3. True.
11. Run edge cases: `suspended` exits 0 and the run is unfinished; after `flow_complete` the process waits up to 30 seconds for background work; `--log-level debug` adds nested blocks; `--capture`. Sections 3 and 7. True, with qualifiers: the wait applies with a config and no dispatching queue, the 30 seconds is the default of `dispatchDrainTimeoutMs`, and the debug lines are stderr log lines, not stdout events. The "Three more cases" opener is a tell and is not carried.
12. CLI output formats: `fsdev run` writes NDJSON to stdout as the run proceeds. Section 7. True.
13. `fsdev run` flags: `--session`, `--seed-session`, `-i`, in-process with the app's models and stores. Sections 2 and 3. True. **Corrected:** `--seed-session` takes JSON or a file path; the "JSON naming the worker" and "refused without it" apply to a flow whose `session.createCheck` needs initial state (a worker flow), not to every flow (`run:427-470`, `[test]` `rct:632-656`). Carried in that general form.
14. `fsdev run` output format with the final `flow_complete`, `error` or `suspended`; stderr names the user (corrected by pass 5). Section 7. True: stderr line `[fsdev] running as ...` (`run:414`).
15. `fsdev dev` and the DevTool address: `?session=<name>` deep link; runs from `fsdev run` appear for the same user and need a reload. **Corrected:** the link is `?session=<id>`, not a name (`apps/docs/docs/devtool/overview.md:93`, `embedding.md:68`). Carried with `<id>`.
16. `fsdev run` arguments, `-i`, `--session`, last line `flow_complete`. Sections 2, 3, 7. True; last line can also be `suspended` or `error`.
17. `fsdev dev` with no `fsdev.config.ts`: store and path `.fsdev/data/fsdev.db`. Sections 3 and 8. True.
18. `fsdev run` output format: one line per item, per streamed-text chunk and per state change. Section 7. True, plus `item_updated` and `item_done`, which the row omits (`run:57-65`).
19. `fsdev dev` flags and defaults, discovery folders, `--flow-dir`, port, `--no-open`, banner lines, `No flows found. Searched: ...` exit. Sections 3 and 4. True, with the exit code stated: **4** (`dev:388`). The banner line is `DevTool server running at ...`, then `Flows:`, `API:`, `Data:`.
20. DevTool caller identity (`devuser`, `fsdev run` uses `devuser` when no resolver or `--org`, reload shows terminal runs; `/?session=<id>`). Sections 3 and 6. True. **Dropped:** the `Refresh sessions` control. No control with that name exists in `apps/devtool/src`, and the DevTool overview says only that a copy's sessions can be re-read (`apps/docs/docs/devtool/overview.md`). The page says "on a reload".
21. Debug endpoints for resources and suspensions. Section 3. **Corrected:** they are forced off on **any** non-loopback host, with or without a config (`dev:290-294`); without a config a non-loopback `--host` is refused anyway (`dev:373-381`). On loopback they are on, and with a config the command only sets defaults for the matching environment variables, so a value already set in the shell or a `.env` file wins (`dev:295-301`). The row also says "resources and suspensions": the code opens one "debug surface" (`dev:421`), and the existing doc names the Resources panel only (`rdoc:131`); the page says "the debug surface the DevTool's Resources panel reads", not suspensions.
22. `fsdev run` output format with `--quiet`, `content_delta` and `flow_complete` fields. Sections 2 and 7. True.
23. `fsdev run` flags: default user, `-u`, `-s`, `-i`, `--quiet` (corrected by pass 5). Sections 2 and 6. True.
24. `fsdev chat <flow> <action>` positional arguments, default target, how the runtime is found. Section 3. True; the row says "config in the cwd, then `src/flows/`, then `flows/`", and discovery also scans the monorepo folders and honours `--flow-dir` (`rf:96-118`).
25. Default-target binding table. Section 3. True; the page's table also has the named-target case and its three failure exits.
26. Message routing: input `{ message }`, failure shape when the schema rejects it. Section 3. True.
27. Live status line (corrected by pass 5). Section 3. True.
28. Slash commands table: six commands, arguments, effect, exit keys. Section 3. True. The exit keys are `/exit`, Ctrl-D and double Ctrl-C; Ctrl-C during a turn aborts the turn.
29. Unrecognised slash input (corrected by pass 5). Section 3. True. Exact grammar: `^/([a-z0-9][a-z0-9-]{0,63})(\s+...)?$`. With no bound target, an unknown valid `/name` prints the unbound hint and counts as a failure in piped mode.
30. Where chat history is stored. Sections 3 and 8. True. With a config it is the app's stores.
31. `--org` and `--user` flags, and what `/status` reports for organization. Sections 3 and 6. True.
32. `--session <id>` resumes a session for the initially bound flow; a different flow's session is rejected. Section 3. True; exit 2. It also needs a bound target.

Dropped: none in full. Three sub-claims dropped or corrected, named above: "loopback-only serving" as a Shift Manager rule (3), the `Refresh sessions` control (20), and suspensions as a thing the debug endpoints open (21). `?session=<name>` is corrected to `<id>` (15). The `--seed-session` "JSON naming the worker" is generalised (13).

## 12. Left out on purpose

- The cut sentence about `fsdev run` running on the production engine (row 9). Implementation.
- The statement that `fsdev gen` loads no app code "because the published CLI is compiled JavaScript on plain Node" (`gen:7-12`). The reader fact is "the generator is the only code it loads"; the reason is mechanism.
- How `--watch` is built (`node --watch` child, preload, boot id). Reader-visible parts only: restart triggers, same port, page reload, in-memory stores reset, loopback only.
- The `[flow-state]` log message strings other than the ones named above.
- `fsdev next-steps` helpers (`CANONICAL_NEXT_STEPS`, `renderNextSteps`, `assertCanonicalNextSteps`): exported (`idx:42`) for shippers who embed the block; not a command. Leave to the starter pages.
- Background work in depth (`ov:78-129`): the page keeps the one rule about the wait and links to the guide on background work.
- Anything about the DevTool's inner screens, beyond the address, `?session=<id>`, the identity and the reload.

## 13. Cold-read questions this sheet can answer (for pass 2)

For the writer of pass 2, the lookups and edge cases the sheet supports:

- Which flag sets the session, and what happens to a run with no `--session`? (section 2, section 8)
- `fsdev run` exits 0 and prints `suspended`. Is the run done? (section 3, 7)
- `fsdev dev --host 0.0.0.0` with no config: what happens? (section 3: exit 3, needs a config)
- Two config files in one folder: which wins? (section 5)
- A monorepo root and the app's `.env.local` one folder down: how to load it? (section 5)
- A resolver that checks a bearer token and `fsdev run`: what happens and what fixes it? (section 6)
- `fsdev gen --check` in CI: what exit code on a stale file, and why its own step? (section 3)
- What does `fsdev block` print when the block throws? (section 3)
- A message typed as `/etc/hosts` in `fsdev chat`: is it sent? (section 3: no)

## Moved to other Reference pages (pass 8)

The page no longer states these; each is a row on the named page, linked from the CLI page. The facts above stay as source for those rows: model override reach (R-21); instance-id naming, seeding rules, flow-definition and duplicate-id rules (R-05); worker-flow seed refusal (R-28); suspended-run holding and deadlines (R-17); background drain, queue modes and `NoRequestHostError` (R-19, R-22); block fields (R-01); debug variables and environment precedence (R-15); `chat.default`, `devtool` and what a config supplies (R-12); resolver order, development identity, pinned flows, session consistency and the bind guard (R-20); event types and fields (R-06); filesystem write guarantees (R-16); `serve` endpoints (R-13); generator contract and workforce output (R-29); worktree discovery and refusal reasons (R-27); `tokens` (R-36); scorecard shape (R-41).
Two facts the page still states changed wording: a `.ts` config can use extensionless relative imports and `tsconfig` path aliases (the `jiti` fallback and "fresh evaluation per load" at `icm:41-59` are not stated, since no command observes them); the `--dotenv` flag note reads "Use `--dotenv`. A `--env-file` flag is taken by Node or tsx and never reaches `fsdev`."
