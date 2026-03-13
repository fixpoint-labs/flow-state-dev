---
sidebar_position: 1
title: "DevTool"
---

# DevTool

The DevTool is a first-party inspector app for flow-state-dev. It lives in the monorepo at `apps/devtool/`. A React app that connects to your flow-state-dev server, it provides visual debugging for flows, sessions, and execution.

## What it is

A visual inspector for flows, sessions, items, and state. No SDK integration required. The DevTool speaks the same HTTP and SSE APIs that your clients use. Point it at a running server and start inspecting.

## How to run it

The DevTool runs as a separate app alongside your server. Start your server (e.g. Next.js, Express) with flows registered, then start the DevTool and configure its base URL to point at that server. It connects to the same API endpoints that clients use.

```bash
cd apps/devtool && pnpm dev
```

Configure the server URL in the DevTool settings. The app will fetch flows and sessions from your server.

## Flow overview

The navigator lists all registered flows and their actions. Pick a flow to inspect. Each flow shows its action names and input schemas. No discovery beyond what the server exposes.

## Session management

Create, browse, and switch between sessions. Sessions are scoped to a flow and a user. The DevTool displays the active session's ID and lets you create new sessions or switch to existing ones. All session operations use the standard server API.

## Action dispatch

Invoke actions directly from the DevTool. Select an action, paste or edit JSON input, and send. The response (request ID, status) appears immediately. Use this to trigger flows without wiring up a UI or writing curl commands.

## Item stream

Watch items arrive in real-time as blocks execute. Messages, tool calls, state changes, and custom components stream in as they're emitted. The Stream tab shows a chronological list of items for the active request. Useful for verifying that the right items are being produced and in the right order.

## Trace view

Visualizes the execution tree. Every item carries provenance: block name, instance ID, parent block, phase, step index. The trace view assembles this into a timeline, grouping items by block and showing parent-child relationships. Helps understand which block produced which output and how sequencer steps relate.

## Session state

Inspect current state at every scope level. View session-level state, user-level state, and project-level state. Resources and their content are visible. ClientData values appear in the detail panel. Refresh after an action completes to see the updated snapshot.

## Replay

Re-stream a previous request to reproduce behavior. Select a completed request and choose replay full or replay from cursor. The DevTool reconnects to the SSE stream (either from the start or from a given sequence number) and replays the events. Useful for debugging intermittent issues or stepping through execution without re-running the flow.

## fsdev dev (coming soon)

A single-command workflow is planned: `fsdev dev` will launch your flows with a local server and open the DevTool against them. For now, run the server and DevTool separately.
