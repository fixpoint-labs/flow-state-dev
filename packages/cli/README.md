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
| `-m, --model <model>` | Override model for all generator blocks |
| `--no-open` | Don't open the browser automatically |

Requires `@flow-state-dev/devtool` to be installed (provides the pre-built UI assets). The CLI lists it as an optional peer dependency.

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
- `@flow-state-dev/server` — execution engine, stores, streaming
- `@flow-state-dev/testing` — isolated block execution context
- `commander` — CLI framework
- `@flow-state-dev/devtool` (optional peer) — pre-built DevTool UI assets for `fsdev dev`

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
