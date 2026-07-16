# @flow-state-dev/cli

**The developer interface. Run flows, execute blocks, inspect definitions — all from the terminal.**

## Installation

```bash
pnpm add -g @flow-state-dev/cli
```

```bash
fsdev run my-agent chat -i '{"message": "Hello!"}'
```

That discovers your flow, executes the action, and streams NDJSON events to stdout as blocks run. Session state persists between invocations.

## Commands

### `fsdev run` — Execute a flow action

Discovers flows from conventional directories (`src/flows/`, `flows/`), validates the action, and executes with streaming output.

```bash
# Inline JSON input
fsdev run knowledge-base-agent answerQuestion \
  -i '{"question": "What is RAG?", "topK": 5}'

# Input from file, reuse a session
fsdev run market-intel-agent runStrategy \
  -f ./test-inputs/strategy.json \
  --session sess_abc123

# Override model for all generators
fsdev run my-agent chat -i '{"message": "hi"}' --model gpt-5

# Seed session state before execution
fsdev run support-triage triageTicket \
  -i '{"ticketId": "T1"}' \
  --seed-session '{"openTicketCount": 3}'
```

Options:

| Flag | Description |
|------|-------------|
| `-i, --input <json>` | Inline JSON input |
| `-f, --input-file <path>` | JSON input from file |
| `-m, --model <model>` | Override model for all generator blocks |
| `-s, --session <id>` | Session ID for reuse across invocations |
| `--seed-session <json\|path>` | Seed session-level state (JSON or file path) |
| `--seed-user <json\|path>` | Seed user-level state |
| `--seed-project <json\|path>` | Seed project-level state |
| `--flow-dir <path>` | Override flow discovery root (repeatable) |
| `--dotenv <path>` | Load a specific `.env` file before the cwd walk-up (repeatable, resolved from cwd) |
| `--format <format>` | Output format (default: `json`) |
| `--quiet` | Suppress `[flow-state] *` runtime logs on stderr |
| `--log-level <level>` | Stderr log level: `debug \| info \| warn \| error` (default: `info`) |
| `--capture <path>` | Write the full structured run output to a JSON file (additive with stdout) |

#### Stderr runtime logs

By default `fsdev run` emits `[flow-state] *` runtime events to stderr at `info` level — action lifecycle, block lifecycle, retries, errors. They are separate from the NDJSON stream on stdout, so piping stdout to `jq` works without filtering. Pass `--quiet` to suppress them entirely; pass `--log-level debug` to include nested-block events.

#### Capture mode

`--capture <path>` writes a single JSON file with the full run for later inspection:

```jsonc
{
  "command": { "flow": "...", "action": "...", "input": {...}, "model": null, "session": null, ... },
  "events":  [ /* every NDJSON event in order */ ],
  "result":  { "success": true, "flow": {...}, "output": {...}, "execution": {...}, "exitCode": 0 }
}
```

Stdout NDJSON streaming continues unchanged when `--capture` is set — you get both. Parent directories are created as needed.

#### NDJSON streaming

Events stream to stdout as blocks execute, one JSON object per line:

```jsonl
{"type":"item_added","item":{"id":"...","type":"message","role":"assistant"}}
{"type":"content_delta","itemId":"msg_1","delta":"Hello"}
{"type":"content_delta","itemId":"msg_1","delta":" there!"}
{"type":"state_change","scope":"session","resourcePath":"counter","changeType":"update"}
{"type":"flow_complete","output":{"reply":"Hello there!"},"durationMs":1234,"items":3}
```

Event types:

| Type | Description |
|------|-------------|
| `item_added` | New output item created |
| `item_updated` | Patch applied to an existing item (e.g. a trace gaining `modelUsage`) |
| `item_done` | Item reached its terminal state; carries the finalized item |
| `content_delta` | Incremental content chunk for an item |
| `state_change` | Scope state or resource was modified |
| `flow_complete` | Action completed successfully |
| `error` | Action failed |

#### Session reuse

Pass `--session` to persist state between invocations:

```bash
# First run — counter starts at 0
fsdev run stateful increment -i '{"increment": 1}' --session my-session
# → {"count": 1}

# Second run — counter continues from 1
fsdev run stateful increment -i '{"increment": 1}' --session my-session
# → {"count": 2}
```

#### Error messages

When a flow or action isn't found, the error lists available options:

```
Flow "chat" not found. Available flows: echo, stateful, knowledge-base-agent
Searched: src/flows/, flows/
```

### `fsdev dev` — Start the DevTool dev server

Starts an HTTP server serving both the flow API and the DevTool UI. Discovers flows, registers them, and opens your browser.

```bash
# Default: port 4200
fsdev dev

# Custom port, model override
fsdev dev --port 3000 --model gpt-4o-mini

# Specific flow directory, no browser
fsdev dev --flow-dir ./my-flows --no-open
```

Options:

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: `4200`) |
| `--flow-dir <path>` | Override flow discovery root (repeatable) |
| `--dotenv <path>` | Load a specific `.env` file before the cwd walk-up (repeatable, resolved from cwd) |
| `-m, --model <model>` | Override model for all generator blocks |
| `--no-open` | Don't open the browser automatically |
| `--dev-auth` | Trust request-body userId for HTTP actions so bearer-gated flows are debuggable in DevTool without a token (local dev only; refuses to run when FSD_DB_URL/DATABASE_URL is set) |

Requires `@flow-state-dev/devtool` to be installed (provides the pre-built UI assets). The CLI lists it as an optional peer dependency.

### `fsdev serve` — Start a production server

Starts an HTTP server for the flow API and MCP endpoints, with no DevTool UI. The production counterpart to `fsdev dev`. It requires a committed `fsdev.config.*` that default-exports a FlowState; without one it errors (no directory discovery, no `--flow-dir`, no `--no-config`).

```bash
# Bind $HOST (then 0.0.0.0) on $PORT (then 3000)
fsdev serve

# Override the port from the environment
PORT=8080 fsdev serve

# Explicit config file
fsdev serve --config ./fsdev.config.ts
```

Options:

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: `$PORT`, then `3000`) |
| `--host <host>` | Host to bind (default: `$HOST`, then `0.0.0.0`) |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--dotenv <path>` | Load a specific `.env` file before the cwd walk-up (repeatable, resolved from cwd) |
| `--allow-unauthenticated` | Skip the loopback-bind guard on a network bind |

Before binding a non-loopback host, `fsdev serve` refuses to start when a served flow has no authentication configured (its `authentication.resolvePrincipal` is unset or the framework default). Fix it by configuring `resolvePrincipal`, binding a loopback host (`--host 127.0.0.1`), or passing `--allow-unauthenticated`. Unlike `fsdev dev`, this command does **not** require `@flow-state-dev/devtool` — it never mounts the UI. It shuts down gracefully on `SIGTERM`/`SIGINT`.

### `fsdev chat` — Hold an interactive session over a flow

Opens a persistent terminal REPL over your flows. Type a message and it routes to the default target, streaming the reply back; a `/`-prefixed line runs a built-in command. Runtime resolution matches `fsdev run` (config wins over discovery).

```bash
# Bind a flow + action and start chatting
fsdev chat hello-chat chat

# Start unbound, then pick a target with /use
fsdev chat

# Resume a session under a specific identity
fsdev chat hello-chat chat --user devuser --session sess_abc
```

Options:

| Flag | Description |
|------|-------------|
| `-s, --session <id>` | Resume an engine session for the initially bound flow |
| `-m, --model <model>` | Override model for all generator blocks |
| `-u, --user <id>` | Engine identity for sessions and turns (default: `cli-user`) |
| `--flow-dir <path>` | Override flow discovery root (repeatable) |
| `--dotenv <path>` | Load a specific `.env` file before the cwd walk-up (repeatable, resolved from cwd) |
| `--quiet` / `--log-level <level>` | Stderr runtime-log discipline (default level `warn`) |

Built-in commands: `/help`, `/targets`, `/use <flow> [action]`, `/status`, `/session [new|<id>]`, `/exit`. A `/name` no built-in claims is sent to the flow as chat text (how skills are invoked). Messages are sent as `{ message: "<text>" }`. Sessions are kept per flow kind and persist in the engine's stores.

### `fsdev block` — Execute a single block in isolation

Runs a block outside of a flow using the testing harness. Useful for development and debugging.

```bash
# Execute a handler block
fsdev block ./src/flows/my-app/blocks/counter.ts \
  -i '{"increment": 1}'

# Override model for a generator block
fsdev block ./src/blocks/summarizer.ts \
  -i '{"text": "..."}' \
  -m gpt-5
```

Options:

| Flag | Description |
|------|-------------|
| `-i, --input <json>` | Inline JSON input |
| `-f, --input-file <path>` | JSON input from file |
| `-m, --model <model>` | Model override for generator blocks |
| `--format <format>` | Output format (default: `json`) |

Output is a JSON object with execution results, schema validation status, and timing:

```json
{
  "success": true,
  "block": { "kind": "handler", "name": "counter" },
  "output": { "count": 1 },
  "schemaValidation": {
    "input": { "passed": true },
    "output": { "passed": true }
  },
  "execution": { "durationMs": 12 }
}
```

### `fsdev benchmark` — Compare coordination patterns

Loads a `defineBenchmark(...)` file, runs each pattern (plus a single-generator baseline) against the same task suite on the same model, and prints a comparative scorecard. One independent variable: the coordination shape. A blinded judge (a distinct model) scores every output against each task's locked rubric.

Real runs make real model calls and need provider credentials in the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`).

```bash
# Default suite, table scorecard
fsdev benchmark ./benchmark.ts

# Markdown table, capped spend
fsdev benchmark ./benchmark.ts --format markdown --max-cost 0.50

# A subset of patterns, one category, written to a file
fsdev benchmark ./benchmark.ts \
  --patterns supervisor,debate \
  --category reasoning \
  --output results.json --format json

# Cross-model: run the patterns on Haiku and compare them against pure Haiku
# AND pure Sonnet ("does a Haiku swarm beat raw Sonnet?")
fsdev benchmark ./benchmark.ts \
  --model anthropic/claude-haiku-4-5 \
  --baseline-model anthropic/claude-sonnet-4-6
```

`--baseline-model` adds a pure single-generator baseline on that model; the run model is always included as the same-model baseline (the delta reference). The other baselines appear as their own rows, so you read whether the patterns beat them from the absolute scores.

Options:

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Override the executor model for all subjects |
| `--judge-model <model>` | Override the judge model |
| `--runs <n>` | Repetitions per (subject, task) |
| `--concurrency <n>` | Concurrent (subject, task, run) cells |
| `--category <name>` | Only run tasks in this category |
| `--patterns <names>` | Comma-separated subset of pattern names to run |
| `--baseline-model <model>` | Add a pure-model baseline to compare against (repeatable; the run model is always included) |
| `--no-baseline` | Skip the single-generator baseline subject |
| `--max-cost <usd>` | Abort the sweep when the estimated cost exceeds this |
| `--output <path>` | Write the scorecard to a file instead of stdout |
| `--format <format>` | `table` \| `markdown` \| `json` (default: `table`) |

Cost is tracked best-effort. When `--max-cost` is exceeded the sweep stops, prints a partial scorecard, and the command exits `1` so CI notices.

A `table` scorecard puts subjects in rows, categories plus `overall` in columns, and `mean±stddev` of the judge score (0-1) in each cell:

```
subject           reasoning     multi-step-research  overall
supervisor        0.840±0.060   0.910±0.040          0.875±0.058
debate            0.870±0.090   0.800±0.080          0.835±0.091
single-generator  0.720±0.070   0.690±0.090          0.705±0.083
```

See the [Benchmarks docs](https://flow-state.dev/docs/testing/benchmarks) for the methodology and the [walkthrough guide](https://flow-state.dev/guides/choosing-patterns-with-benchmarks) for a worked example.

## Environment variables

`fsdev run`, `fsdev dev`, `fsdev serve`, `fsdev chat`, and `fsdev benchmark` load `.env.local` before importing your config, so generator providers see your gateway and API keys. `fsdev serve` also reads `$HOST` and `$PORT` for its bind defaults.

Resolution, highest precedence first:

1. The real shell environment. Anything already exported always wins — a file never overwrites it.
2. Files named with `--dotenv <path>`, in the order given.
3. `.env.local` in the working directory, then each parent directory up to the filesystem root.

The auto walk-up only climbs, so running from the repo root will not find an app's `.env.local` one level down. Point at it explicitly:

```bash
# from the repo root, load the app's env:
fsdev run my-flow action -i '{}' --dotenv apps/my-app/.env.local
```

`--dotenv` is repeatable and resolved relative to cwd (absolute paths work too). A named file that doesn't exist is an error, unlike the silent walk-up. The flag is `--dotenv` rather than `--env-file` because Node and tsx reserve `--env-file` as a built-in flag and would intercept it before the CLI sees it.

## Flow discovery

Flows are discovered from conventional directories relative to the working directory:

```
src/flows/<flow-name>/flow.ts   → default exports a FlowInstance
flows/<flow-name>/flow.ts       → default exports a FlowInstance
flows/<flow-name>.ts            → direct file export
```

In monorepo structures, the CLI also scans one level of subdirectories under `packages/`, `examples/`, `apps/`, and `labs/`:

```
packages/*/src/flows/<flow-name>/flow.ts
packages/*/flows/<flow-name>/flow.ts
examples/*/src/flows/<flow-name>/flow.ts
apps/*/src/flows/<flow-name>/flow.ts
labs/*/src/flows/<flow-name>/flow.ts
```

Use `--flow-dir` to override default discovery with explicit paths:

```bash
# Search only specific directories
fsdev run my-flow action -i '{}' --flow-dir ./packages/api/src/flows --flow-dir ./shared/flows
```

Each module must default-export a `FlowInstance` created by `defineFlow(...)({ id: "..." })`. When the same flow kind is found in multiple directories, the first discovery wins.

A module that throws during import doesn't abort discovery: the CLI prints a `Warning: failed to import flow module: <path>` diagnostic to stderr and lists the failure in the "not found" error, so a broken flow is distinguishable from a missing one.

## Using `fsdev.config.ts`

Directory discovery covers a simple app whose providers are env-keyed. An app with intent-mapped models, a gateway, or a custom store adapter keeps that wiring in its `createFlowState` call. Put a `fsdev.config.ts` at your project root that default-exports that same FlowState handle, and `fsdev run`, `fsdev dev`, and `fsdev chat` use your registry, stores, and model resolver instead of CLI defaults.

The CLI searches the current directory for `fsdev.config.{ts,mts,js,mjs}` (TS first). Pass `--config <path>` to point at an explicit file, or `--no-config` to ignore any config and force directory discovery. With a config loaded, `--model` is routed through your resolver, and `--flow-dir` is rejected (use `--no-config` if you wanted directory discovery).

```ts title="fsdev.config.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "./src/flows/chat/flow";

export default createFlowState({
  flows: { chat: chatFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

A `.ts` config needs Node >= 22.18 (native type stripping) or tsx in a consumer repo; an `.mjs`/`.js` config works everywhere. See [App Configuration](https://flow-state.dev/docs/cli/configuration) for the full convention, runtime requirements, and caveats.

## Programmatic API

The CLI exports its core utilities for use in scripts, CI, and tooling:

```ts
import {
  discoverFlows,
  resolveFlow,
  isFlowInstance,
  resolveBlock,
  isBlockDefinition,
  parseInputArg,
  formatOutput,
} from "@flow-state-dev/cli";

import type { FlowRunResult, FlowEvent, BlockExecResult } from "@flow-state-dev/cli";
```

`discoverFlows` accepts an `onImportFailed` callback in its options object, invoked with a `FlowImportFailure` (`filePath`, `message`, `cause`) for each module that throws during import. Discovery continues with remaining modules; without the callback, failures are skipped silently.

## Dependencies

- `@flow-state-dev/core` — block/flow type definitions
- `@flow-state-dev/engine` — execution engine, stores, streaming
- `@flow-state-dev/testing` — isolated block execution context
- `commander` — CLI framework
- `@flow-state-dev/devtool` (optional peer) — pre-built DevTool UI assets for `fsdev dev` only; `fsdev serve` does not need it

## Scripts

```bash
pnpm --filter @flow-state-dev/cli build
pnpm --filter @flow-state-dev/cli typecheck
pnpm --filter @flow-state-dev/cli test
```

## Architecture reference

- [Flows](https://flow-state.dev/docs/fundamentals/flows) — defineFlow, actions, lifecycle
- [Blocks](https://flow-state.dev/docs/fundamentals/blocks) — The four block kinds
- [Streaming](https://flow-state.dev/docs/streaming/overview) — Item/content model, event taxonomy
