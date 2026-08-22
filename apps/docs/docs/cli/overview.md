---
sidebar_position: 1
title: CLI
sidebar_label: Overview
---

# CLI

The CLI is how you run the engine from the terminal. The command is `fsdev`. Install `@flow-state-dev/fsdev` and you can run a flow, isolate a block, hold a chat, or start the DevTool, without standing up a Next.js app first.

## Commands

| Command | What it does |
|---------|--------------|
| `fsdev run <flow> <action>` | Run one action in-process. NDJSON on stdout. |
| `fsdev block <file>` | Run one block through the test harness. |
| `fsdev chat [flow] [action]` | Interactive multi-turn session in the terminal. |
| `fsdev dev` | HTTP + DevTool UI on localhost. |
| `fsdev serve` | Production HTTP + MCP. No DevTool. |
| `fsdev benchmark <file>` | Score a `defineBenchmark` file. |
| `fsdev ui add <name>` | Install a component from the UI registry. |

Flags, NDJSON events, and exit codes live in the [CLI API](/docs/api/cli).

`run`, `block`, and `chat` call the engine in-process: no HTTP server and no SSE. That is the Flow State transport only — a generator still calls its model provider over the network and still needs that provider's key. `dev` and `serve` start a host. See [Engine setup](/docs/server/setup) and [Deployment](/guides/deployment).

This page is about running *your own* flows locally. To dispatch a coding task to a Claude Code *cloud* session from inside a flow, see [Claude Code remote dispatch](/docs/tools/claude-code-cli).

## When to use it

- **Visual debugging** — `fsdev dev` starts the DevTool alongside your flows. Inspect sessions, stream items in real-time, dispatch actions from the browser. See [DevTool](/docs/devtool/overview) for details.
- **Serving in production** — `fsdev serve` runs the flow API and MCP endpoints with no DevTool UI, binding `0.0.0.0:$PORT` for a PaaS. It is the production counterpart to `fsdev dev`. See [Deployment overview](/guides/deployment).
- **Quick iteration** — `fsdev run` executes a flow action and prints results. No need to start a server or open a browser.
- **Testing blocks in isolation** — Use `fsdev block` to execute a single block with the test harness. Good for verifying handler logic or generator output without wiring up a full flow.
- **Holding a live conversation** — `fsdev chat` opens an interactive session over your flows: type messages that stream replies back, switch which flow is driving, and inspect the session, all from the terminal. See [Interactive Chat](./interactive-chat.md).
- **Debugging multi-turn conversations** — Reuse sessions across invocations with `--session`. State persists between runs so you can simulate back-and-forth without a client.
- **CI/CD scripts** — Invoke flows or blocks from pipelines. Deterministic output format, clear exit codes. Use the programmatic API (`discoverFlows`, `resolveBlock`) when you need flow discovery in Node scripts.

## Running flows

`fsdev run <flow> <action>` executes an action and streams NDJSON to stdout. Each line is a JSON event: `item_added`, `content_delta`, `state_change`, `flow_complete`, or `error`. Pipe to `jq` or parse programmatically. Input comes from `-i` (inline JSON) or `-f` (file path).

Session reuse: pass `--session <id>` to continue an existing session. State from the previous run is loaded. Useful for multi-turn flows.

## Running blocks

`fsdev block <file>` runs a single block with the test harness. Provide input via `-i` or `-f`. The block executes in isolation; no flow context, no session unless you seed it. Output includes success/failure, schema validation results, and execution duration. Ideal for unit-testing block logic.

## Flow discovery

The CLI auto-discovers flows from conventional directories: `src/flows/`, `flows/`. In monorepos, it also scans one level under `packages/`, `examples/`, `apps/`, and `labs/`. Override with `--flow-dir` (repeatable) to point at custom locations. When `--flow-dir` is used, default discovery is skipped and only the specified directories are searched.

When a discovered flow module fails to import, the CLI prints a warning to stderr and lists the failed module in the "not found" error, so a broken flow is distinguishable from a missing one.

When an `fsdev.config.ts` is present at your project root, the CLI skips auto-discovery and uses the app's own wiring instead: its flow registry, model resolver, and store profiles, the same ones your server uses. See [App Configuration](./configuration) for the convention.

## Model overrides

Use `-m` to swap models without code changes. Pass a model ID (e.g. `openai/gpt-5.4-mini`, `anthropic/claude-haiku-4-5`). Useful for testing with cheaper or faster models during development.

Every generator that runs in the command's own process uses the override, including generators in [background work that runs there](#waiting-for-in-process-work).

The override does not cross a queue. When background work is [handed to a queue](#with-a-queue-the-command-doesnt-wait), another process runs it under its own model configuration, so the generators inside it use whatever model that process resolves. A flow that detaches through a queue therefore runs on two models at once: the one you passed, and the worker's. If you are comparing models, or forcing a cheap one, the result only covers the part that ran here.

You get a line on stderr at each dispatch that loses the override:

```
[flow-state] the model override on this run does NOT apply to background work dispatched to a queue: request "req_8f21c0" (flow "research") will run under the worker's own model configuration, not the override. Generators in this process still use it.
```

`--quiet` silences that line, the same as the other stderr notices.

## State seeding

`--seed-session`, `--seed-user`, and `--seed-org` let you start with specific state for debugging. Pass inline JSON or a file path. The seeded state is merged into the scopes before execution. Handy for reproducing issues that depend on prior state.

## Background work

A flow can hand a unit of work to a *workstream*, a background child session that keeps running after the request that started it has returned. `fsdev run` and `fsdev chat` can start one. What the command does about it depends on how the app is wired.

| Your setup | What the command does |
|---|---|
| `fsdev.config.*`, no queue | Runs the work in this process, and waits for it before exiting |
| `fsdev.config.*` with a dispatching queue adapter (`colocated`, `dispatch-only`) | Hands the work to the queue, and returns without waiting for it to run |
| No config (directory discovery or `--no-config`) | Can't start background work; the call fails by name |
| A `worker-only` process | Runs the work in this process rather than putting it on the queue. Not durable: if the process stops, nothing re-runs it |

For what a workstream is and how tasks group into one, see [Work that outlives the turn](/guides/background-work).

### Waiting for in-process work

Without a queue, the workstream runs inside the same process as the command. The action that launched it returns straight away, which is what detaching means, so `flow_complete` lands on stdout while the background work is still going. The command holds the process open until that work finishes, and says so on stderr:

```
[flowstate] waiting for 1 detached request(s) to finish before shutdown {"pending":1}
```

A run whose NDJSON already looks complete but whose shell prompt hasn't come back is usually sitting here.

`--quiet` suppresses the line, not the wait. So does `--log-level error`, since the notice is logged at `warn`. Either way the command stays up until the work is done.

Background work can start more background work, and the wait covers descendants too. The wait is bounded: it runs against `detachedDrainTimeoutMs`, a `createFlowState` option that defaults to 30 seconds, and a flow that spawns without end hits a round cap as well. When the budget runs out the command cancels what's still running, names the requests and sessions it gave up on, and exits. That report goes to stderr even under `--quiet`, since work may have been left unfinished.

`fsdev chat` waits at the equivalent point in its own life, which is when you leave the session rather than at the end of each turn.

### With a queue, the command doesn't wait

When the config hands `createFlowState` a worker adapter that dispatches, meaning `colocated` (the default) or `dispatch-only`, background work goes to the queue instead of running in the command's own process, and the wait above doesn't apply.

By the time the command returns, the request has been recorded and the queue has accepted the job. A failed store write or a rejected enqueue fails the dispatch rather than reporting a start, so a queue you can't reach surfaces as an error instead of as silence.

None of that says the job survives, or that it ever runs. Whatever consumes the queue decides that, and a queue with nothing draining it is an ordinary state: the job sits in it, and the command finishes the same way it would if a worker were pulling from it. Read the workstream's own requests to find out what became of it. See [Background work](/docs/server/background-work).

### Without a config, background work can't start

Directory discovery and `--no-config` give the CLI flows and stores, and no runtime host for a workstream to start through. A block that reaches for one throws:

```
NoRequestHostError: This capability needs a runtime host, and none is wired on this context.
```

The error carries `code: "no-request-host"`, and on a task board the row the work was claimed for is recorded failed.

Run against an `fsdev.config.*` to exercise a flow's background work from the terminal.

### From a worker-only process

A process whose worker adapter runs `mode: "worker-only"` consumes the queue and dispatches nothing. Background work started there runs inside the worker process itself, the same way it runs with no queue configured. Nothing is enqueued.

**That work is not durable.** If the process stops, the run stops with it and nothing re-runs it: the request record stops where it stopped, and a task board row the work had claimed is left unfinished. For the queue to own the work, start it from a process that has a dispatcher, which means `colocated` or `dispatch-only`.

Shutdown treats it as in-process work, so the process waits for it the way it waits above.

## Next steps

- [Agent Dev Loop](./agent-dev-loop.md) — The recommended edit → `fsdev run` → read NDJSON loop, with worked examples and `jq` recipes. If you're iterating on a flow, start here.
- [Interactive Chat](./interactive-chat.md) — Hold a live, multi-turn session over your flows with `fsdev chat`.
- [CLI API](/docs/api/cli) — Full command reference, NDJSON event types, programmatic API, exit codes.
- [Development Tips](/guides/development-tips) — Workflow patterns for using the CLI in daily development.
