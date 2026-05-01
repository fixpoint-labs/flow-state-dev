---
sidebar_position: 1
title: "CLI"
---

# CLI

`@flow-state-dev/cli` provides the `fsdev` command. Run flows and blocks from the terminal without a running server. Useful for development, testing, and automation.

## What it is

The CLI executes flows and blocks in-process. No HTTP server, no SSE, no network. It uses the same runtime and stores as the server package, but invoked directly from your shell. Output streams as NDJSON to stdout.

## When to use it

- **Visual debugging** — `fsdev dev` starts the DevTool alongside your flows. Inspect sessions, stream items in real-time, dispatch actions from the browser. See [DevTool](/docs/devtool/overview) for details.
- **Quick iteration** — `fsdev run` executes a flow action and prints results. No need to start a server or open a browser.
- **Testing blocks in isolation** — Use `fsdev block` to execute a single block with the test harness. Good for verifying handler logic or generator output without wiring up a full flow.
- **Debugging multi-turn conversations** — Reuse sessions across invocations with `--session`. State persists between runs so you can simulate back-and-forth without a client.
- **CI/CD scripts** — Invoke flows or blocks from pipelines. Deterministic output format, clear exit codes. Use the programmatic API (`discoverFlows`, `resolveBlock`) when you need flow discovery in Node scripts.

## Running flows

`fsdev run <flow> <action>` executes an action and streams NDJSON to stdout. Each line is a JSON event: `item_added`, `content_delta`, `state_change`, `flow_complete`, or `error`. Pipe to `jq` or parse programmatically. Input comes from `-i` (inline JSON) or `-f` (file path).

Session reuse: pass `--session <id>` to continue an existing session. State from the previous run is loaded. Useful for multi-turn flows.

## Running blocks

`fsdev block <file>` runs a single block with the test harness. Provide input via `-i` or `-f`. The block executes in isolation; no flow context, no session unless you seed it. Output includes success/failure, schema validation results, and execution duration. Ideal for unit-testing block logic.

## Flow discovery

The CLI auto-discovers flows from conventional directories: `src/flows/`, `flows/`. In monorepos, it also scans one level under `packages/`, `examples/`, and `apps/`. Override with `--flow-dir` (repeatable) to point at custom locations. When `--flow-dir` is used, default discovery is skipped and only the specified directories are searched.

## Model overrides

Use `-m` to swap models without code changes. Pass a model ID (e.g. `gpt-4o-mini`, `claude-3-haiku`). All generator blocks in the run use the overridden model. Useful for testing with cheaper or faster models during development.

## State seeding

`--seed-session`, `--seed-user`, and `--seed-project` let you start with specific state for debugging. Pass inline JSON or a file path. The seeded state is merged into the scopes before execution. Handy for reproducing issues that depend on prior state.

## Next steps

- [Agent Dev Loop](./agent-dev-loop.md) — The recommended edit → `fsdev run` → read NDJSON loop, with worked examples and `jq` recipes. If you're iterating on a flow, start here.
- [CLI API Reference](/docs/api/cli) — Full command reference, NDJSON event types, programmatic API, exit codes.
- [Development Tips](/guides/development-tips) — Workflow patterns for using the CLI in daily development.
