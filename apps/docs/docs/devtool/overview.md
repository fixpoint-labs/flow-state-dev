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

Pick a block from the tree and the detail panel opens with two symmetric sections, Input and Output. Each is a `BlockValue`: it can be inline content, a ref to an upstream item that the panel resolves and renders, or a structure of refs (for fan-in steps like `thenAll` or `parallel`). Clicking a ref jumps to the source block.

Blocks that are still running show their live status. A `block_trace` row appears as soon as the block starts, with input filled in and output empty. As patches arrive — connector input, generator bundle, model usage — the panel updates in place. The Output section becomes live once the block returns.

For generator blocks, the panel also shows what the model actually saw on that turn: the resolved system prompt, the user-slot messages for this turn, and the conversation history that came in alongside them. Tools and the resolved model identifier appear in the same panel. This is observability data — gated by `FSDEV_TRACE_OBSERVABILITY` (on by default in development) — so you can leave it on while iterating and switch it off in production.

### Error details

When a block fails, the detail panel surfaces enough context to diagnose without re-running. The error message renders at the top with the `code` as a small mono-text label. When the runtime captures `details` on the failure — generator output-validation errors carry the raw model text and the Zod issues, author-thrown `FlowError`s carry whatever was attached — the panel renders them as dedicated sections: a "Raw output" pane for the model's text, a typed "Validation issues" list for Zod issues, and a "Details" JSON panel for the rest. For tool-invoked blocks that fail, the panel also surfaces the originating tool call's arguments and the block's resolved input, so the failure stops requiring a hunt through sibling rows for the missing context. See [Error handling](/docs/advanced/error-handling).

## Session state

Inspect current state at every scope level. View session-level state, user-level state, and org-level state. Resources and their content are visible. ClientData values appear in the detail panel.

The Resources panel reads from a privileged debug endpoint and shows the full server-side state. Each entry can be toggled between the raw server view, the client view (what production clients receive after `client.data` projection), and a diff between the two. Production clients see only what each resource's `client` config allows. See [Debug vs client state](./debug-vs-client-state.md) for the mental model and how to enable the endpoint locally.

## Replay

Re-stream a previous request to reproduce behavior. Select a completed request and choose replay full or replay from cursor. The DevTool reconnects to the SSE stream and replays the events.

## Embedding the panel

The same UI ships as a React component you can mount inside any framework app. Useful for inspecting flows on Vercel previews and other deployed environments without leaving the app's origin. See [Embedding DevTool](./embedding.md).
