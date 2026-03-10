---
sidebar_position: 6
---

# CLI API

`@flow-state-dev/cli` — Terminal interface for running flows, executing blocks, and inspecting definitions.

## Commands

### `fsdev run <flowKind> <action>`

Execute a flow action with streaming NDJSON output.

```bash
fsdev run my-agent chat -i '{"message": "Hello!"}'
```

**Options:**

| Flag | Description |
|------|-------------|
| `-i, --input <json>` | Inline JSON input |
| `-f, --input-file <path>` | JSON input from file |
| `-m, --model <model>` | Override model for all generator blocks |
| `-s, --session <id>` | Session ID for reuse across invocations |
| `--seed-session <json\|path>` | Seed session-level state (JSON or file path) |
| `--seed-user <json\|path>` | Seed user-level state |
| `--seed-project <json\|path>` | Seed project-level state |
| `--format <format>` | Output format (default: `json`) |

**NDJSON events:**

Each line of stdout is a JSON object with a `type` field:

```jsonl
{"type":"item_added","item":{"id":"...","type":"message","role":"assistant"}}
{"type":"content_delta","itemId":"msg_1","delta":"Hello there!"}
{"type":"state_change","scope":"session","resourcePath":"counter","changeType":"update"}
{"type":"flow_complete","output":{"reply":"Hello there!"},"durationMs":1234,"items":3}
```

| Event type | When it fires |
|------------|---------------|
| `item_added` | A new output item (message, reasoning, tool call, etc.) was created |
| `content_delta` | Incremental content chunk for a streaming item |
| `state_change` | A scope state or resource was modified |
| `flow_complete` | The action completed successfully |
| `error` | The action failed |

**Session reuse:**

```bash
# State persists between invocations with the same --session
fsdev run stateful increment -i '{"increment": 1}' --session my-session
# → {"count": 1}

fsdev run stateful increment -i '{"increment": 1}' --session my-session
# → {"count": 2}
```

### `fsdev block <specifier>`

Execute a single block in isolation using the testing harness.

```bash
fsdev block ./src/flows/my-app/blocks/counter.ts -i '{"increment": 1}'
```

**Options:**

| Flag | Description |
|------|-------------|
| `-i, --input <json>` | Inline JSON input |
| `-f, --input-file <path>` | JSON input from file |
| `-m, --model <model>` | Model override for generator blocks |
| `--format <format>` | Output format (default: `json`) |

**Output:**

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

## Flow Discovery

`fsdev run` discovers flows automatically from these directories (relative to cwd):

```text
src/flows/<flow-name>/flow.ts   → default exports a FlowInstance
flows/<flow-name>/flow.ts       → default exports a FlowInstance
flows/<flow-name>.ts            → direct file export
```

When a flow or action isn't found, the error message lists what was discovered:

```text
Flow "chat" not found. Available flows: echo, stateful, my-agent
Searched: src/flows/, flows/
```

## Programmatic API

The CLI exports its utilities for use in scripts and CI:

### `discoverFlows(cwd?)`

Scan conventional directories and return all discovered flow instances.

```ts
import { discoverFlows } from "@flow-state-dev/cli";

const flows = await discoverFlows("./my-project");
// FlowInstance[]
```

### `resolveFlow(specifier)`

Load a single flow from an explicit file path.

```ts
import { resolveFlow } from "@flow-state-dev/cli";

const flow = await resolveFlow("./src/flows/my-chat/flow.ts");
```

### `resolveBlock(specifier)`

Load a single block from a file path.

```ts
import { resolveBlock } from "@flow-state-dev/cli";

const block = await resolveBlock("./src/blocks/counter.ts");
```

### `parseInputArg(options)`

Parse input from `--input` or `--input-file` flags.

### `formatOutput(value, format)`

Format a value for terminal output.

### Type Exports

```ts
import type {
  FlowRunResult,  // Structured result from fsdev run
  FlowEvent,      // NDJSON event union type
  BlockExecResult, // Structured result from fsdev block
} from "@flow-state-dev/cli";
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error (flow or block failed at runtime) |
| 2 | Invalid arguments (unknown flow, bad input, etc.) |
