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
| `--seed-org <json\|path>` | Seed org-level state |
| `--flow-dir <path>` | Override flow discovery root (repeatable). Errors if a config is loaded. |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--no-config` | Ignore any config and force directory discovery |
| `--dotenv <path>` | Load a specific `.env` file before the cwd `.env.local` walk-up (repeatable, resolved from cwd) |
| `--format <format>` | Output format (default: `json`) |

When a config is loaded, `fsdev run` looks up the flow by `kind` in the config's registry and uses its stores. `--model <id>` still applies, routed through the config's own resolver (your gateways and providers stay in effect). `--flow-dir` together with a config is an error; the message suggests `--no-config` if directory discovery is what you want. The config's FlowState is disposed on exit. See [App Configuration](/docs/cli/configuration).

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

### `fsdev dev`

Start an HTTP dev server that serves the flow API and DevTool UI together.

```bash
fsdev dev
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: `4200`) |
| `--flow-dir <path>` | Override flow discovery root (repeatable). Errors if a config is loaded. |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--no-config` | Ignore any config and force directory discovery |
| `--dotenv <path>` | Load a specific `.env` file before the cwd `.env.local` walk-up (repeatable, resolved from cwd) |
| `-m, --model <model>` | Override model for all generator blocks. Errors if a config is loaded. |
| `--no-open` | Don't open the browser automatically |

**Requires:** `@flow-state-dev/devtool` installed (provides the pre-built UI assets).

Without a config, the server discovers flows, registers them in an in-memory flow registry, creates filesystem stores at `.fsdev/data/`, and starts listening. With an `fsdev.config.ts` present, it serves the app's own router (`await flowState.getRouter()`) using the config's registry, resolver, and stores. Because the config builds the router with its own resolver, `--model` together with a config is an error. API routes are served at `/api/flows/*`. The DevTool UI is served for all other paths. See [DevTool Setup](/docs/devtool/setup) and [App Configuration](/docs/cli/configuration) for full details.

### `fsdev serve`

Start a production HTTP server for the flow API and MCP endpoints, with no DevTool UI. This is the production counterpart to `fsdev dev`.

```bash
fsdev serve
```

**Options:**

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: `$PORT`, then `3000`) |
| `--host <host>` | Host to bind (default: `$HOST`, then `0.0.0.0`) |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--dotenv <path>` | Load a specific `.env` file before the cwd `.env.local` walk-up (repeatable, resolved from cwd) |
| `--allow-unauthenticated` | Skip the loopback-bind guard and allow a network bind even when a flow has no authentication configured |

`fsdev serve` requires a committed `fsdev.config.*` that default-exports a FlowState. It does not do directory discovery; without a config it errors. There is no `--flow-dir` and no `--no-config`.

The two server commands differ in what they mount and where they bind. `fsdev dev` serves the flow API plus the DevTool UI, opens a browser, and binds a fixed port `4200` on a loopback host for local work. `fsdev serve` serves the flow API and MCP endpoints only, binds `$PORT` (then `3000`) on `$HOST` (then `0.0.0.0`) for a PaaS, and never mounts the DevTool SPA. Under the hood it wraps `serve()` from `@flow-state-dev/node` with no `staticDir`, so a non-API GET like `/index.html` returns 404. Bind defaults are the inverse of `dev`: `serve` reaches for a network host and an env-provided port, `dev` stays on loopback and `4200`.

**Loopback-bind guard.** Before binding a non-loopback host, `fsdev serve` checks that every served flow has authentication configured. A flow whose `authentication.resolvePrincipal` is unset or left at the framework default runs on an unauthenticated principal, and exposing it on a network interface would open it to anyone who can reach the port. The guard refuses that bind. Resolve it one of three ways: configure `authentication.resolvePrincipal` on the flow, bind a loopback host (`--host 127.0.0.1`), or pass `--allow-unauthenticated` to opt out deliberately. Loopback binds skip the guard. A configured resolver protects the flow's whole API surface, session and resource endpoints included, so passing the guard means the deployment is covered rather than just its action routes. See [Authentication](/docs/server/authentication).

Exit code `3` covers an invalid port, a missing committed config, a guard refusal, and a bind or listen failure such as `EADDRINUSE` or `EACCES`. The server shuts down gracefully on `SIGTERM` and `SIGINT`.

```bash
# Bind $HOST (then 0.0.0.0) on $PORT (then 3000)
fsdev serve

# Override the port from the environment
PORT=8080 fsdev serve

# Point at an explicit config file
fsdev serve --config ./fsdev.config.ts
```

See [App Configuration](/docs/cli/configuration) for the config contract, [Host adapters](/docs/server/host-adapters) for the `serve()` wrapper this command uses, [MCP Server](/docs/server/mcp) for the MCP endpoints it stands up, and the [Deployment overview](/guides/deployment) for platform guidance.

### `fsdev chat [flow] [action]`

Start an interactive session (a REPL) over a flow. Type messages that route to a default target and stream replies back; use slash commands to switch the target and inspect the session.

```bash
fsdev chat hello-chat chat
```

**Options:**

| Flag | Description |
|------|-------------|
| `-s, --session <id>` | Resume an engine session for the initially bound flow. Requires a bound target. |
| `-m, --model <model>` | Override model for all generator blocks |
| `-u, --user <id>` | Engine identity for sessions and turns (default: `cli-user`) |
| `--flow-dir <path>` | Override flow discovery root (repeatable). Errors if a config is loaded. |
| `--config <path>` | Load an explicit `fsdev.config` file instead of searching the cwd |
| `--no-config` | Ignore any config and force directory discovery |
| `--dotenv <path>` | Load a specific `.env` file before the cwd `.env.local` walk-up (repeatable, resolved from cwd) |
| `--quiet` | Suppress runtime logs on stderr |
| `--log-level <level>` | Stderr log level: `debug` \| `info` \| `warn` \| `error` (default: `warn`) |

**Built-in commands:**

| Command | Description |
|---------|-------------|
| `/help` | List the built-in commands |
| `/targets` | List available `flow · action` targets; the current default is marked |
| `/use <flow> [action]` | Switch the default target |
| `/status` | Show target, session id, turn count, and runtime source |
| `/session [new\|<id>]` | Print, rotate (`new`), or bind (`<id>`) the current flow's session |
| `/exit` | Leave the session (also Ctrl-D, double Ctrl-C) |

A `/name` that no built-in claims is sent to the flow as chat text (this is how a project's skills are invoked). A leading space escapes command parsing. Messages are sent as `{ message: "<text>" }`; a target whose action rejects that shape fails the turn without ending the session.

Startup binds a default target from the positional arguments, a config `chat.default`, or a sole discovered flow; otherwise the session starts unbound. Runtime resolution matches `fsdev run` (an `fsdev.config.ts` wins over discovery). No new exit codes: startup failures reuse `EXIT_CONFIG_ERROR` / `EXIT_DISCOVERY_ERROR` / `EXIT_INVALID_ARGS`; a failed turn never exits the loop, and in piped (non-TTY) mode a run with any failed turn or built-in exits `EXIT_EXECUTION_ERROR`. See [Interactive Chat](/docs/cli/interactive-chat) for the guide.

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

### Monorepo support

In monorepo structures, the CLI also scans one level of subdirectories under `packages/`, `examples/`, `apps/`, and `labs/`:

```text
packages/*/src/flows/
packages/*/flows/
examples/*/src/flows/
apps/*/src/flows/
labs/*/src/flows/
```

This means flows defined anywhere in your monorepo are automatically discoverable without configuration.

### Custom flow directories

Use `--flow-dir` to override default discovery with explicit paths. This is repeatable:

```bash
fsdev run my-flow action -i '{}' \
  --flow-dir ./packages/api/src/flows \
  --flow-dir ./shared/flows
```

When `--flow-dir` is specified, only the given directories are searched — the default and monorepo scanning is skipped.

### Error messages

When a flow or action isn't found, the error lists what was discovered, where it searched, and any modules that were found but failed to import:

```text
Flow "chat" not found. Available flows: echo, stateful, my-agent
Searched: src/flows, flows, examples/hello-chat/src/flows
1 flow module(s) failed to import:
  /repo/examples/chat/src/flows/chat/flow.ts: Error: Cannot find package 'left-pad'
```

A module that throws during import also produces a stderr warning at discovery time, so a broken flow is distinguishable from a missing one even when the run otherwise succeeds.

Discovery is the default. When an `fsdev.config.ts` is present, the CLI uses the app's registry, resolver, and stores instead, and these directories are not scanned. See [App Configuration](/docs/cli/configuration).

## Programmatic API

The CLI exports its utilities for use in scripts and CI:

### `discoverFlows(cwdOrOptions?)`

Scan conventional directories and return all discovered flow instances. Accepts a string (cwd) or an options object.

```ts
import { discoverFlows } from "@flow-state-dev/cli";

// Simple: scan from a directory
const flows = await discoverFlows("./my-project");

// With options: explicit directories
const flows2 = await discoverFlows({
  cwd: "./my-project",
  flowDirs: ["packages/api/src/flows", "shared/flows"],
});

// Observe modules that throw during import
const flows3 = await discoverFlows({
  cwd: "./my-project",
  onImportFailed: (failure) => {
    console.warn(`${failure.filePath}: ${failure.message}`);
  },
});
```

Modules that throw during import are skipped and reported through the `onImportFailed` callback; without it they are skipped silently. Each `FlowImportFailure` carries `filePath` (absolute path), `message` (normalized error text), and `cause` (the original thrown value).

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
| 2 | Invalid arguments (bad JSON input, missing required flags) |
| 3 | Configuration error (invalid port, missing devtool assets) |
| 4 | Discovery error (flow or block not found, import failed) |
| 10 | Internal error (unhandled exception) |
