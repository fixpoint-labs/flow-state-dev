---
sidebar_position: 1
title: "DevTool"
---

# DevTool

The DevTool is a visual inspector for flow-state-dev. It connects to your running flows over HTTP and SSE, giving you a live view of sessions, items, state, and execution traces. No SDK integration required.

## Getting started

Install the DevTool package alongside the CLI:

```bash
pnpm add -D @flow-state-dev/devtool
```

Then run `fsdev dev` from your project root:

```bash
fsdev dev
```

This starts an HTTP server that serves both your flow API and the DevTool UI. Open the printed URL (default: `http://localhost:4200`) in your browser. The DevTool discovers all flows in your project and is ready to use.

## How `fsdev dev` works

The command does three things:

1. **Discovers flows** from `src/flows/` and `flows/` (same convention as `fsdev run`).
2. **Starts an HTTP server** that routes `/api/flows/*` to the flow API router and serves the DevTool UI for everything else.
3. **Opens your browser** pointing at the DevTool.

Flow data persists to `.fsdev/data/` on disk, so sessions survive restarts.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | `4200` | Port to listen on |
| `--flow-dir <path>` | auto-discover | Override flow discovery root (repeatable) |
| `-m, --model <model>` | — | Override model for all generator blocks |
| `--no-open` | — | Don't open the browser automatically |

### Example

```bash
# Start with a custom port and model override
fsdev dev --port 3000 --model gpt-4o-mini

# Point at a specific flow directory
fsdev dev --flow-dir ./my-flows
```

## Flow overview

The navigator lists all registered flows and their actions. Pick a flow to inspect. Each flow shows its action names and input schemas.

## Session management

Create, browse, and switch between sessions. Sessions are scoped to a flow and a user. The DevTool displays the active session's ID and lets you create new sessions or switch to existing ones.

## Action dispatch

Invoke actions directly from the DevTool. Select an action, paste or edit JSON input, and send. The response (request ID, status) appears immediately. Use this to trigger flows without wiring up a UI or writing curl commands.

## Item stream

Watch items arrive in real-time as blocks execute. Messages, tool calls, state changes, and custom components stream in as they're emitted. The Stream tab shows a chronological list of items for the active request.

## Trace view

Visualizes the execution tree. Every item carries provenance: block name, instance ID, parent block, phase, step index. The trace view assembles this into a timeline, grouping items by block and showing parent-child relationships.

## Session state

Inspect current state at every scope level. View session-level state, user-level state, and project-level state. Resources and their content are visible. ClientData values appear in the detail panel.

## Replay

Re-stream a previous request to reproduce behavior. Select a completed request and choose replay full or replay from cursor. The DevTool reconnects to the SSE stream and replays the events.
