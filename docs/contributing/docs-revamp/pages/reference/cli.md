---
title: CLI
type: reference
description: "Every fsdev command and flag, the config file it loads, what each command prints, and its exit codes."
---

# CLI

`fsdev` is the terminal interface to a Flow State app. Use it, or have a coding agent use it, to run a flow, a single block or a chat without building a UI or standing up a server. It comes from `@flow-state-dev/fsdev`, needs Node 22 or later, and finds your flows either from an `fsdev.config.ts` file or by looking in the usual folders.

`run`, `block` and `chat` call the engine inside the command's own process: no HTTP server, no streaming connection. A generator block (a block that calls a model) in them calls its model provider over the network and needs that provider's key. `dev` and `serve` start an HTTP host instead.

This page uses one app. It has a flow with the id `research` and an action `start`, and a block file at `src/flows/research/blocks/plan-queries.ts`.

```bash
fsdev run research start -i '{"topic":"battery chemistry"}' --session s1
fsdev block src/flows/research/blocks/plan-queries.ts -i '{"topic":"battery chemistry"}'
fsdev dev
```

## Commands

| Command | What it does |
| --- | --- |
| `fsdev run <flowKind> <action>` | Runs one action in the terminal and prints one JSON event per line to stdout. |
| `fsdev block <specifier>` | Runs one block alone and prints one JSON document. |
| `fsdev chat [flow] [action]` | A terminal REPL over your flows. |
| `fsdev dev` | HTTP server for the flow API plus the DevTool, or your own app's pages. Needs `@flow-state-dev/devtool` unless you pass `--app`. |
| `fsdev serve` | HTTP server for the flow API and MCP endpoints, with no DevTool. Needs a committed config. |
| `fsdev gen` | Writes the module an app registers its code from, using a code generator one of its dependencies supplies. |
| `fsdev ui add <components...>`, `fsdev ui list` | Installs components from the UI registry, or lists them. |
| `fsdev worktrees <root>` | Lists, or removes, the git worktrees a workspace host made for coding runs. |
| `fsdev benchmark <file>` | Runs a `defineBenchmark` file and prints a scorecard. |

`shift-manager` is a separate command from `@flow-state-dev/shift-manager`. It is not an `fsdev` subcommand; see [The `shift-manager` command](#the-shift-manager-command).

## Flags shared by several commands

A flag here means the same thing on every command that takes it.

| Flag | Meaning | Commands |
| --- | --- | --- |
| `-s, --session <id>` | The session to run in, so state carries across invocations. Without it, `run` mints a fresh session id for every run. On `chat` it resumes a session for the initially bound flow. | `run`, `chat` |
| `-i, --input <json>` | Inline JSON input. | `run`, `block` |
| `-f, --input-file <path>` | JSON input from a file, relative to the working directory. A leading BOM is ignored. | `run`, `block` |
| `-m, --model <model>` | Forces every generator that runs in this process onto one model id. | `run`, `block`, `chat`, `dev`, `benchmark` |
| `-u, --user <id>` | Run as this user. | `run`, `chat` |
| `--org <id>` | Run in this organization and skip the app's resolver. | `run`, `chat` |
| `--flow-dir <path>` | Replace flow discovery with only the folders given. Repeatable. Exits 2 when a config loads. | `run`, `chat`, `dev` |
| `--config <path>` | Load this config file instead of searching the working directory. | `run`, `chat`, `dev`, `serve` |
| `--no-config` | Ignore any config and use folder discovery. | `run`, `chat`, `dev` |
| `--dotenv <path>` | Load a `.env` file before the `.env.local` walk-up. Repeatable. | `run`, `chat`, `dev`, `serve`, `benchmark` |
| `--quiet` | Silences stderr runtime logs. | `run`, `chat` |
| `--log-level <level>` | `debug`, `info`, `warn` or `error`. Any other value exits 2. Default `info` on `run`, `warn` on `chat`. | `run`, `chat` |
| `--store <kind>` | Without a config, `sqlite` (default) or `filesystem`. Exits 2 for any other value, and when a config loaded. | `run`, `dev` |
| `-p, --port <port>` | Port to listen on. `0` picks a free port. Default `4200` on `dev`; `$PORT`, then `3000`, on `serve`. | `dev`, `serve` |
| `--host <host>` | Host to bind. Default `127.0.0.1` on `dev`; `$HOST`, then `0.0.0.0`, on `serve`. | `dev`, `serve` |
| `--allow-unauthenticated` | Bind a non-loopback host even when a flow has no authentication. | `dev`, `serve` |
| `--format <format>` | Output format. `block` prints JSON whatever the value; `benchmark` takes `table`, `markdown` or `json`. | `block`, `benchmark` |

Input rules, for `-i` and `-f`:

- Passing both exits 2: `Cannot specify both --input and --input-file`.
- Invalid JSON exits 2: `Invalid JSON in --input flag`. An unreadable file exits 2: `Cannot read input file: <path>`.
- With neither flag, the action receives `{}`.

With a config, `run` and `chat` send the model id through the config's own resolver, so its gateways and providers apply. `dev` refuses the combination: `--model can't be combined with fsdev.config.*`, exit 2. What the override does and does not reach: [Models](./models.md).

Use `--dotenv`. A `--env-file` flag is taken by Node or tsx and never reaches `fsdev`.

## `fsdev run`

`fsdev run <flowKind> <action>`. The first argument is a flow instance id; [Flows and actions](./flows.md) says how to name one copy of a flow. The flags are the shared ones above, plus:

| Flag | Meaning |
| --- | --- |
| `--seed-session <json\|path>` | Seeds session state before the run. Inline JSON if the value starts with `{` or `[`, otherwise a file path. |
| `--capture <path>` | Writes the whole run (command, events, result) to one JSON file, additive with stdout. Parent folders are created. A failed write is reported on stderr and does not change the exit code. |

The checks run in this order, and nothing is written before the identity and session checks pass:

| Check | On failure |
| --- | --- |
| Flow found | Exit 4. Lists the ids that exist. Without a config, also `Searched: <dirs>` and any modules that failed to import. |
| Action found on the flow | Exit 2: `Action "<a>" not found on flow "<f>". Available actions: ...` |
| Input parsed | Exit 2. |
| Identity resolved | Exit 2. See [Who a run is](#who-a-run-is). |
| An existing session belongs to this instance | Exit 2: `Session "<id>" belongs to flow instance "<x>", not "<y>"; nothing was written`. |
| Seed accepted | Exit 2. A seed that is not valid JSON or cannot be read says so: `Invalid JSON in --seed-session`, `Cannot read seed file for --seed-session: <path>` or `Invalid JSON in seed file for --seed-session: <path>`. A seed the flow refuses (a server-owned field on a new session, a readonly field on an existing one) ends `Nothing was written`. |

Seeding: how a seed is checked on a new session and on an existing one, and what is refused, is in [Flows and actions](./flows.md). A flow whose session needs initial state refuses a new session with no seed; [`WORKER.md`](./worker-md.md) covers a worker flow.

After the run:

- A flow that pauses for a user prints a `suspended` event and exits 0, with a waiting report on stderr. What a held run is and how it resumes: [Pause, resume and replay](./durable-execution.md).
- With a config, the process stays up after `flow_complete` while background work the run started finishes, up to `dispatchDrainTimeoutMs` (default 30 seconds). What that wait covers and what a job queue changes: [Background work](./background-work.md).
- With no config, background work cannot start: see [Errors](./errors.md).
- With no config and a failed `intent/*` model, stderr adds a hint that no `fsdev.config.*` was found. `--no-config` and `--quiet` suppress it.
- A config's `FlowState` is disposed on exit. A disposal failure prints `Warning: failed to dispose fsdev config: ...` and does not change the result.

## `fsdev block`

`fsdev block <specifier>` runs one block alone: no flow, no session, user id `cli-user`.

| Argument or flag | Meaning |
| --- | --- |
| `<specifier>` | Path to a block file, absolute or relative to the working directory. |
| `-i, --input <json>`, `-f, --input-file <path>` | Input, as for `run`. |
| `-m, --model <model>` | Model override. An unmocked generator calls the real provider. |
| `--format <format>` | Default `json`. `json` is the only format; any value prints JSON. |

The file must default-export the block. The fields every block takes are in [Blocks](./blocks.md).

Output is one pretty-printed JSON document on stdout:

```json
{
  "success": true,
  "block": { "kind": "handler", "name": "plan-queries" },
  "output": { "queries": ["battery chemistry overview"] },
  "schemaValidation": { "input": { "passed": true }, "output": { "passed": true } },
  "execution": { "durationMs": 12 }
}
```

- `schemaValidation.input` and `.output` are each `{ passed: boolean, errors?: string[] }`. A block with no schema passes. A validation failure is reported and does not stop the run.
- When the block throws, `success` is `false`, `output` is `null`, an `error: { message, stack? }` is added, and `schemaValidation.output.passed` is `true`, because it is not checked.
- Exit codes: 0 on success, 1 when the block throws, 2 for bad input flags, 4 when the block file cannot be loaded. The load messages are `Block file not found: <path>`, `Failed to import block file: <message>`, `Block file has no default export: <path>` and `Default export is not a valid BlockDefinition (must have kind, name, and run): <path>`.

## `fsdev chat`

`fsdev chat [flow] [action]`. Flags: `-s`, `-m`, `-u`, `--org`, `--flow-dir`, `--dotenv`, `--config`, `--no-config`, `--quiet`, `--log-level`. There is no `--store` and no `--capture`.

The two positional arguments are the pair `run` takes, and they set the default target: where typed messages go. The runtime is found as `run` finds it. With a config, `--flow-dir` exits 2.

| Situation | Result |
| --- | --- |
| A flow and action named on the command line | Bound to it. An unknown flow exits 4, an unknown action exits 2. A flow with several actions and no action named exits 2: `Flow "<f>" has multiple actions: ... Specify one: fsdev chat <f> <action>`. |
| Nothing named, the config sets `chat: { default: "<flow>" }` or `"<flow>.<action>"` | Bound to it. A name that matches no flow or action, or is ambiguous, exits 3. |
| Nothing named, exactly one flow with exactly one action | Bound automatically. |
| Nothing named, several available | Starts unbound: `/targets` lists them, `/use <flow>` binds one. |
| No flows at all | Exit 4: `No flows found. Searched: ...`, or `No flow targets available to chat with.` with a config. |

- **Sessions.** Each flow gets its own session within a run, so history does not bleed across `/use`; switching away and back resumes the first. `--session <id>` resumes a session for the initially bound flow. With no bound target it exits 2. A session that belongs to a different flow, or has finished requests from a different flow, exits 2.
- **Messages** are sent as `{ message: "<text>" }`. If the target's input schema rejects that, the turn fails with the validation error and the line `That target isn't chat-shaped (its action rejected { message }). Pick another with /use, or /targets to list them.` The session stays open.
- **Printing.** Assistant text streams as it arrives. A tool call prints `· tool call: <name>`, an error prints `· error: <message>`, a persistent status prints `· status: <message>`. Reasoning, traces and the echo of your own message are not printed.
- **Live status line.** A transient status an in-flight block reports updates in place on one line and clears when real output arrives. It is drawn only on an interactive terminal and skipped, silently, with piped input.
- **A turn that stops for a user** prints `Waiting for a person: <what> (suspension <id>). <where to answer>`. The session stays open.
- **History** is stored in `.fsdev/data/fsdev.db` (SQLite) without a config, the file `run` and `dev` share. With a config, history goes to the app's stores.

Slash commands:

| Command | Effect |
| --- | --- |
| `/help` | Lists the commands. |
| `/targets` | Lists `flow · action` targets. The default is marked `*`. |
| `/use <flow> [action]` | Switches the default target. |
| `/status` | Prints `Target:`, `Session:`, `Turns:`, `Org:`, `Source:` and `Store:` lines. |
| `/session [new\|<id>]` | With no argument, prints the current flow's session id. `new` rotates it and resets history. An id binds that session, under the same checks as `--session`. A nonexistent id is created on the first turn. |
| `/exit` | Leaves the session. |

Other `/` input:

- A `/name [args]` that no built-in claims, where `name` is lowercase letters, digits and hyphens, at most 64 characters, starting with a letter or digit, is sent to the flow unchanged when a target is bound. With no target bound, it prints `No default target — pick one with /use <flow> [action] (see /targets).`
- Any other line starting with `/` (a lone `/`, uppercase, a path such as `/etc/hosts`) is not sent. It prints `type /help for commands`. A leading space sends a literal message that begins with `/`.
- Exit keys: `/exit`, Ctrl-D, and a double Ctrl-C when idle. During a turn, Ctrl-C aborts the turn and the loop stays up.
- Piped (non-interactive) input exits 1 if any turn failed or any built-in refused, including a message sent with no bound target. On a terminal it exits 0 on `/exit`, Ctrl-D or the double Ctrl-C.

## `fsdev dev`

Flags: `-p, --port`, `--host`, `--allow-unauthenticated`, `--app <package|dir>`, `--watch`, `--flow-dir`, `--dotenv`, `--config`, `--no-config`, `-m, --model`, `--no-open`, `--store`.

One process serves the flow API at `/api/flows` and the DevTool's pages at every other path, on one port. It opens a browser unless you pass `--no-open`.

Banner, on stderr:

```text
DevTool server running at http://localhost:4200

Flows:  research
API:    http://localhost:4200/api/flows
Data:   .fsdev/data/fsdev.db (SQLite)
```

- With the default bind, `127.0.0.1` prints as `localhost`. `Data:` reads `config: <path>` when a config loaded.
- With `--app`, the first lines are `App:     <url>  (<pages dir>)` and `DevTool: <url>`, or `DevTool: not served` when the DevTool package is not installed or its assets are not built. The app starts either way.

| Situation | Result |
| --- | --- |
| No `@flow-state-dev/devtool` and no `--app` | Exit 3: `DevTool assets not found.` |
| No config and no flows found | Exit 4: `No flows found. Searched: <dirs>`, plus any modules that failed to import. |
| A config that fails to initialise | Exit 3: `Failed to initialize fsdev config <path>: <message>`. |
| `--port` is not all digits, or above 65535 | Exit 3: `Invalid port: <value>`. |
| The port is taken, or the bind fails | Exit 3, with the server's message. |
| A config, with `--model`, `--flow-dir` or `--store` | Exit 2. |

Without a config, `dev` serves the flows discovery finds, stores their data in `.fsdev/data/fsdev.db` (SQLite) by default, applies `--model`, and holds a paused request until it is answered from the DevTool. With a config, `dev` serves the config's own `FlowState`.

**`--host`.** The default is loopback only.

- A non-loopback host needs a config, otherwise exit 3: `Refusing to bind <host>: a non-loopback host needs an fsdev config (--config), so its authentication can be checked.`
- It runs the same authentication check as `serve`, which `--allow-unauthenticated` skips.
- It exits 3 when the config hands the DevTool page a bearer token.
- On a non-loopback host, the debug endpoints behind the DevTool's Resources panel are off. On a loopback host they are on, unless a config loaded and the environment already sets the debug variables ([Environment variables](./environment.md) lists them and their defaults). They are not for production.

**`--watch`.** Loopback only; any other host exits 3. It restarts the server on the same port, and reloads open pages, when:

- a file the config loaded changes;
- a file in the config's folder changes, such as a `WORKER.md`, or a new file appears there;
- a `.env.local` that `fsdev` loaded changes.

A data file, anything under `node_modules` and a folder whose name starts with a dot do nothing. A restart is a new process, so a config with in-memory stores starts empty each time. If the server fails to start after a save, the error prints and `dev` waits for the next save. With `--port 0`, the free port is picked once and kept.

**`--app <package|dir>`.** Serves your own app's pages at the root and moves the DevTool to a port of its own. It takes a folder with an `index.html`, or a package that exports `getAssetPath()`, a function returning that folder. A relative path or package name resolves from the folder you ran the command in. It exits 3 when the folder is missing, has no `index.html`, the package is not installed, or `getAssetPath()` is missing, throws or returns no string.

- The API stays at `/api/flows` on the same origin.
- Each HTML page carries `window.__FSD_DEVTOOL_CONFIG__` (loopback hosts only) and `<meta name="fsdev-devtool-url" content="...">`. The meta is absent when the DevTool is not served, or when `--host` is `0.0.0.0` or `::`.
- With `--watch`, a package that also exports `getSourceRoot()` is served from that folder through the app's own Vite. With nothing returned, or no Vite installed there, the built pages are served and the command says so.

**Identity and the DevTool.** The DevTool acts as `devuser` unless the config's `devtool.userId` says otherwise. A run from `fsdev run` appears in the DevTool when it ran as the same user. A running `dev` does not hear a separate process's writes as they happen, so an open page shows them on its next read, such as a reload. `?session=<id>` on the DevTool's address opens that session.

`SIGINT` or `SIGTERM` prints `Shutting down...`, closes the servers, disposes the runtime and exits 0.

## `fsdev serve`

Flags: `-p, --port`, `--host`, `--config`, `--dotenv`, `--allow-unauthenticated`. There is no `--flow-dir`, `--no-config`, `--store` or `--model`.

- **Config.** It needs a committed config, checked before any flow module is imported. With none: exit 3, `fsdev serve requires a committed fsdev.config.{ts,mts,js,mjs} in <cwd>.`
- **Port.** `--port` wins over `$PORT`. Both must be all digits from 0 to 65535, else exit 3, and this is checked before the config loads. An empty `$PORT` counts as unset.
- **Host.** `--host` wins over `$HOST`. An empty `$HOST` counts as unset.
- **Authentication guard.** A non-loopback host exits 3 when a served flow has no authentication. Loopback binds and `--allow-unauthenticated` skip the guard. What counts as authentication, and the ways out: [Authentication and tenancy](./authentication.md).
- **Exit 3** also covers a bind or listen failure and a router that fails to initialise after the socket binds (`Server failed to initialize: ...`).
- **What it serves.** The endpoints are in [HTTP API](./http-api.md). There is no static folder, so a GET such as `/index.html` returns 404. The config's `devtool` block is ignored.
- **Output**, on stderr: `Server running at http://<host>:<port>`, `API:    http://<host>:<port>/api/flows`, `Config: <path>`.
- `SIGINT` or `SIGTERM` prints `Shutting down...`, drains, disposes and exits 0.

## `fsdev gen`

Flags: `--root <dir>`, `--check`.

`gen` runs the code generator one of the app's dependencies supplies and writes the one file it renders. It reads the `package.json` nearest the working directory, and its `dependencies` and `devDependencies`, looking for a package that exports a `./fsdev-gen` subpath. Run it from the app's folder. The generator is the only code it loads: not `fsdev.config.ts`, not any file under the root.

Workforce apps list `@flow-state-dev/workforce` in their `dependencies` as the generator. What it reads and writes: [The workforce folder](./workforce-folder.md).

| Flag | Meaning |
| --- | --- |
| `--root <dir>` | The folder the generator reads, relative to the working directory. Default: the generator's own `defaultRoot` (`workforce` for Workforce). The file is written under it. |
| `--check` | Writes nothing. Exit 0 and `<file> is up to date (<summary>).` when the committed file matches. Otherwise exit 1, with ``<file> is out of date. Run `fsdev gen` and commit the result.`` and every discovered path on stderr. |

- Exactly one code generator must exist. With none, or with more than one, or with a package whose `./fsdev-gen` export lacks a `generator` with `defaultRoot` and `generate`, or with no `package.json`: exit 3.
- Output on success is `Looked in: <dirs>`, one `<path> -> <name>` line per registration, then `Wrote <file> (<summary>).` or `<file> unchanged (<summary>).`
- Comparison ignores CRLF against LF. Writes are always LF. A symlink at the generated file's path exits 3, for a write and for `--check`.
- Exit codes: 0 written, unchanged or current; 1 when `--check` finds the file stale, or when the generator refuses the tree; 3 for any other failure.
- In CI, run `--check` as its own step. Inside a build script that already ran `fsdev gen` it always passes.

A package supplies a generator by exporting `generator` on `./fsdev-gen`:

| Member | Meaning |
| --- | --- |
| `defaultRoot: string` | The root, relative to the working directory, when `--root` is not given. |
| `generate(root: string)` | Reads `root` (absolute) and returns the module below. Must not write. |
| `generate` returns `file` | The file to write, relative to the root. |
| `content` | The module's full text. |
| `searched` | The folders looked in, printed as `Looked in:`. |
| `entries` | One line per registration, printed as found. |
| `paths` | Every discovered path, listed when `--check` finds the file stale. |
| `summary` | A one-line count of what was found, printed in parentheses. |

A refusal of what the root holds is thrown as an error carrying `problems: string[]`; the command exits 1. Any other throw exits 3.

## `fsdev ui`

| Command | Flags | Behavior |
| --- | --- | --- |
| `fsdev ui add <components...>` | `--registry <url>` (default `https://ui.flow-state.dev/r`), `--cwd <dir>` | Runs `npx shadcn@latest add <registry>/<name>.json ...` once for all names. Prints `Installing <names>...`. Exit 0, or 1 and `Failed to install <names>.`. A local `--registry` path resolves `<path>/<name>.json`. |
| `fsdev ui list` | `--registry <url>`, `--category <cat>` | Prints `<registry name> — <n> component(s)` and each component's name and description. `No components found.` when the filter matches nothing. Exit 3 with `Could not load registry manifest.` when the manifest cannot be fetched. |

- The same install without the CLI: `npx shadcn@latest add https://ui.flow-state.dev/r/<name>.json`.
- Components are copied into `components/flow-state/` and become the project's own source.
- `fsdev ui add tokens` installs the colour tokens the components read. Which components depend on it: [UI components](./ui-components.md).

## `fsdev worktrees`

`fsdev worktrees <root>`. Flags: `--repo <path...>`, `--remove <dir>`, `--delete-branch`, `--force`, `--json`.

- **Listing** is the default. One line per worktree: `clean`, `dirty` or `gone` (its folder is missing), then the branch (`(detached)` for a detached HEAD), then the folder. `No worktrees.` when none. `--json` prints an array of `{ place, dir, cwd, repository, branch, head, dirty }`.
- **`--remove <dir>`** removes that worktree. `--delete-branch` deletes its branch too. `--force`, with `--delete-branch`, deletes a branch holding the only copy of some commits. Success prints `Removed <cwd>` and one of `.`, ` and deleted branch <b>.` or `; branch <b> kept.`
- **Refusals** exit 1 with `Refused (<reason>): <message>`, and remove nothing. How worktrees are found and what each reason means: [Harness runs](./harness-runs.md).
- A missing `<root>` exits 2.

## `fsdev benchmark`

`fsdev benchmark <file>` runs a `defineBenchmark` file.

| Flag | Meaning |
| --- | --- |
| `-m, --model <model>` | Override the executor model for all subjects. |
| `--judge-model <model>` | Override the judge model. |
| `--runs <n>` | Repetitions per (subject, task). Positive integer. |
| `--concurrency <n>` | Concurrent (subject, task, run) cells. Positive integer. |
| `--category <name>` | Only run tasks in this category. Exit 2 if none match. |
| `--patterns <names>` | Comma-separated subset of pattern names. |
| `--baseline-model <model>` | Add a pure-model baseline. Repeatable. The run model is always included. |
| `--no-baseline` | Skip every baseline subject, including the pure-model baselines `--baseline-model` adds. |
| `--max-cost <usd>` | Abort the sweep when the estimated cost exceeds this. Positive number. |
| `--search` | Force provider-native web search on, overriding the definition's `disableSearch`. |
| `--output <path>` | Write the scorecard to a file instead of stdout. |
| `--dotenv <path>` | Load a `.env` file. Repeatable. |
| `--format <format>` | `table` (default), `markdown` or `json`. Anything else exits 2. |

A non-numeric or non-positive numeric flag exits 2. The command exits 1 when `--max-cost` is exceeded and the sweep stops, and prints a partial scorecard. The scorecard's shape is in [Patterns](./patterns.md). See also [Benchmark patterns](../build/benchmark-patterns.md).

## Flow discovery

`run`, `chat` and `dev` use discovery when no config loads: none is present, or `--no-config` was passed.

- **Where it looks**, relative to the working directory: `src/flows/` and `flows/`; then, one level under each of `packages/`, `examples/`, `apps/` and `labs/`, the `src/flows/` and `flows/` of each subfolder.
- **What it loads.** Inside a flows folder: each subfolder with a `flow.ts`, `flow.js`, `index.ts` or `index.js` that default-exports a flow, and each `.ts` or `.js` file directly in the folder. A module that imports fine but is not a flow is skipped silently.
- **`--flow-dir <path>`**, repeatable, replaces the search with only the folders given, absolute or relative to the working directory. With a config it exits 2: `--flow-dir bypasses fsdev.config.*; pass --no-config to use directory discovery.`
- What counts as a flow, and what happens to two flows with one id: [Flows and actions](./flows.md).
- A module that throws on import is reported on stderr as `Warning: failed to import flow module: <path>` plus the message, and the scan continues. A later "not found" error lists those modules.

## The config file

| Item | Rule |
| --- | --- |
| Name | `fsdev.config.ts`, `.mts`, `.js` or `.mjs`, searched in that order, in the working directory only. It does not walk up. If more than one exists, the first wins and stderr prints `Warning: multiple fsdev config files found; using <a>, ignoring <b>`. |
| Export | A `FlowState`, the object `createFlowState()` returns, as the default export. Otherwise exit 3: `fsdev config <path> must default-export a FlowState`. |
| `--config <path>` | Names the file and skips the search. A missing file exits 3: `Config file not found: <path> (resolved to <abs>)`. |
| `--no-config` | Ignores any config. `serve` has `--config` but not `--no-config`, and no discovery. |
| Load failure | A config that throws on import exits 3: `Failed to load fsdev config <path>: <message>`. |
| `chat.default`, `devtool` | Options on `createFlowState`. `fsdev chat` reads the first and `fsdev dev` the second; both are in [Runtime configuration](./runtime.md). |

- **When a config loads**, the registry, stores and model resolver come from your `FlowState`: [Runtime configuration](./runtime.md) lists what it supplies and what the CLI adds.
- **Loading a `.ts` config.** It can use extensionless relative imports and `tsconfig` path aliases such as `@/flows/chat/flow`. `.js` and `.mjs` configs load as a plain import.

Environment files are read before the config is imported, so the config's providers see the keys. The order of the shell, `--dotenv` files and `.env.local`, and the accepted line forms, are in [Environment variables](./environment.md). A `--dotenv` file that does not exist exits 3: `--dotenv file not found: <path>`.

## Who a run is

`run` and `chat` ask the app who the caller is, the way an HTTP action request is asked, then run as that user in that organization. How the resolver is chosen, what it sees, the development default identity, and the refusals for owner-pinned flows and resumed sessions: [Authentication and tenancy](./authentication.md).

| Situation | Result |
| --- | --- |
| `-u, --user <id>` | Replaces only the user. The organization comes from the resolver. A blank value exits 2: `--user must be a nonempty user id.` |
| `--org <id>` | Skips the resolver and runs as `--user`, or `devuser`. It must be nonempty and well-formed and not `DEFAULT_ORG_ID`, else exit 2. `serve` and `dev` have no such flag. |
| A resolver that checks a credential | The terminal carries none. It throws or returns `null`, and the run exits 2 before writing: `Flow "<f>" refused this terminal: <reason>`, then `Pass --org <id> to name the organization yourself. Nothing was written.` On `chat`, only that turn fails. |

- Unless `--quiet`, `run` prints one stderr line before the action: `[fsdev] running as <user>[ (named by --user)] in organization <org> (<named by --org | no resolver configured | from the app's resolver>)`.
- `--capture` records the identity as `command.principal`: `{ userId, orgId, from }`. `from` is `resolver`, `flag` or `development-default`, and describes the organization only.
- `chat` asks per turn, for that turn's target. `/status` prints `Org: <org> (user <u>, <from>)` for the target's last turn, or `Org: (asked on each turn)` before its first.

## Output formats

stdout carries a command's result and stderr carries logs, notices and errors, so a pipe sees only the result. `--quiet` on `run` silences the `[flow-state] ...` runtime logs, the `[fsdev] running as ...` line, the waiting report, and the missing-config hint. It does not silence the report of unfinished background work, printed when `dispatchDrainTimeoutMs` runs out, or a `--capture` write failure.

`--log-level debug` adds log lines for blocks nested in sequencers and routers (`nested block started`, `nested block completed`) and for router choices (`router selected route`). They are stderr lines, not events.

| Command | Output |
| --- | --- |
| `run` | NDJSON on stdout: one event per line, as the run proceeds. |
| `block` | One JSON document on stdout. |
| `chat` | A plain-text transcript. |
| `dev`, `serve` | Banner lines on stderr. Nothing on stdout. |
| `gen` | Plain text lines. |
| `benchmark` | The scorecard on stdout, or in `--output <path>`, as `table`, `markdown` or `json`. |
| `worktrees` | One line per worktree, or JSON with `--json`. |
| `ui list` | A header line and one line per component. |

### `fsdev run` events

`run` prints one event per line. Every event type, with its fields, is in [Items and the stream](./items.md). Three of them end a run and are always the last line: `flow_complete`, `suspended` and `error`.

A run that reaches the engine ends with exactly one of those three. A failure before that (unknown flow, unknown action, bad input, a refused identity, a refused seed, a bad config) prints its message on stderr, exits non-zero and emits no event. Exit code: 0 on `flow_complete` and on `suspended`, 1 on `error`.

Filtering the stream for the final answer:

```bash
fsdev run research start -i '{"topic":"battery chemistry"}' --quiet | tail -n 1
```

**The `--capture` file** is `{ command, events, result }`. `command` is `{ flow, action, input, model, session, seedSession, principal }`, `events` is every event in order, and `result` is `{ success, flow: { kind, action }, output, execution: { durationMs, itemCount }, error?: { message, stack?, code? }, suspended?, exitCode }`. Unset values are `null`. It holds no session or resource state.

**The waiting report**, on stderr when a run ends `suspended`:

```text
[fsdev] waiting for a person: <message, else title, else reason>
[fsdev]   suspension <id> · request <id> · session <id>
[fsdev]   <where to answer it>
[fsdev]   Its deadline fires only while a server runs on this store.
```

Where to answer is `fsdev dev` on the default store, `fsdev dev --store filesystem` started after the run exits, or a server on the app's stores when a config loaded. `--store filesystem` also prints, unless `--quiet`, that the store is single-process: do not run `fsdev dev` on it while the run is going.

### Exit codes

| Code | Constant | Used for |
| --- | --- | --- |
| 0 | `EXIT_SUCCESS` | Success, and `run` ending `suspended`. |
| 1 | `EXIT_EXECUTION_ERROR` | `run` ended `error`. `block` threw. `gen` found a stale file under `--check`, or the generator refused the tree. `worktrees` refused or failed. `ui add` failed. `benchmark` stopped over `--max-cost`. `chat` in piped mode after a failed turn or built-in. |
| 2 | `EXIT_INVALID_ARGS` | Bad JSON input, or both `-i` and `-f`. Unknown action. Unknown `--log-level`. Bad `--store`. `--store`, `--flow-dir` or `dev --model` with a config. Bad `--org` or `--user`. A refused identity, session or seed. `chat --session` with no bound target. `worktrees` with a missing root. A bad `benchmark` numeric flag or `--format`. A `benchmark` file that is not a `defineBenchmark` definition, or has no registry or neither `subjects` nor `patterns`. |
| 3 | `EXIT_CONFIG_ERROR` | Config not found, not a `FlowState`, or failing to load or initialise. A named `--dotenv` file missing. An invalid port. A bind or listen failure. The `serve` authentication guard. `dev --watch` on a non-loopback host. DevTool assets not found. `--app` problems. `gen` setup problems. A `chat.default` that names nothing. `ui list` with no manifest. |
| 4 | `EXIT_DISCOVERY_ERROR` | Flow not found, or no flows found. Block file not found, not importable, with no default export, or not a block. A `benchmark` file that cannot be imported. |
| 10 | `EXIT_INTERNAL_ERROR` | An unhandled exception: `Unexpected error: <message>` on stderr. |

The constants are exported from `@flow-state-dev/fsdev`.

## What the CLI stores

| Part | Owner | Who sees it | Where | How many |
| --- | --- | --- | --- | --- |
| Sessions and requests from `run` and `chat`, with no config | The user and organization the run was made as. A session keeps its identity and refuses anyone else. Default user `devuser`. | `fsdev dev` started in the same folder lists them for the DevTool's user. A different user cannot resume them. | `.fsdev/data/fsdev.db` (SQLite) under the working directory, or JSON files under `.fsdev/data` with `--store filesystem`. The two stores do not see each other's sessions. | One database per working directory. One session per `--session` id. Without `--session`, `run` mints a new session per invocation. `chat` keeps one session per flow within a run. |
| The same, with a config | As above, in the app's own stores. | Whatever reads those stores, such as a server on the same config. | The store profile the config declares. An in-memory profile persists nothing. | As the stores hold. |
| A `--capture` file | Whoever ran the command. | Anyone who can read the path. | The path given, parent folders created, overwritten on each run. | One per path. |
| The module from `fsdev gen` | The app. Commit it. | Anyone with the repo. | `<root>/<file>`, such as `workforce/workforce.gen.ts`. Rewritten only when its content changes. | One per generator per app. |
| Components from `fsdev ui add`, and the `tokens` entries | The project. They are copies; edit them. | Anyone with the repo. | `components/flow-state/`, and the project's stylesheet for tokens. | One set per component. |

The `.fsdev/data` folder can be written by the app and the CLI together. What that guarantees across processes, and what an in-memory profile persists: [Stores](./stores.md).

## The `shift-manager` command

`shift-manager` starts Shift Manager, the browser app a Workforce Lab is worked through, from `@flow-state-dev/shift-manager`. It needs Node 22 or later. One process serves the Lab's API under `/api/flows`, Shift Manager's pages, and the DevTool on a port of its own.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config <path>` | `fsdev.config.*` in the folder the command was typed in, searched in the order above | The Lab's config. A relative path resolves from there. None found exits 3: `No fsdev config in <dir>. Pass --config <path to the Lab's fsdev config>.` |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests, and always refused when the Lab hands its page a bearer token. |
| `--shift <day\|evening\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on that theme. An unknown name exits 3 and lists the known ones. |
| `--dev` | off | Restarts the Lab, and reloads the page, when a file it loaded changes, `WORKER.md` included. Loopback only. A restart is a new process, so a Lab with in-memory stores starts empty each time. |
| `--assets <dir>` | the built pages in the package | Serve a different build of the pages. Same as `fsdev dev --app <dir>`. |
| `--no-open` | opens the browser | Do not open the browser. |

Unknown flags and positional arguments exit 3. Paths resolve from where the command was typed, and the process runs there, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`. Without the DevTool package installed, Shift Manager starts and turns *Open trace* off.

## Next

- [Background work](../concepts/background-work.md), for what a `run` waits on after `flow_complete`.
- [Debug a run](../build/debug-a-run.md), for the write, run, read and fix loop over `fsdev run`.
- [Chat from the terminal](../build/chat-from-the-terminal.md), for `fsdev chat` in use.
