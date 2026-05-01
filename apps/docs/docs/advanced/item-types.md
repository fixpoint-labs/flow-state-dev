---
sidebar_position: 7
---

# Full item-types reference

Items are the runtime records produced while a flow runs. They power streaming, session history, model context, and devtool traces.

Most application code only needs [Streaming and Items](/docs/streaming/overview) and [Emitting Items](/docs/streaming/emitting-items). This page is the full registry in one place.

## Item types

| Type | Produced by | Client | History | Persistence |
|------|-------------|:------:|:-------:|-------------|
| `message` | Generator auto-emission, `ctx.emitMessage()` | Agent-type governed | Agent-type governed | Persistent |
| `reasoning` | Generator auto-emission for reasoning-capable models | Agent-type governed | Agent-type governed | Persistent |
| `block_tool_output` | Generator tool loop | Agent-type governed | Agent-type governed | Persistent |
| `component` | `ctx.emitComponent()` | Yes | No | Persistent by default |
| `container` | Runtime grouping | Yes | No | Persistent |
| `source` | Web search and source-producing generators | Yes | No | Persistent |
| `status` | `ctx.emitStatus()` and `activeStatusMessage` | Yes | No | Always transient |
| `state_change` | Scope state mutations | Yes | No | Transient in production |
| `resource_change` | Resource mutations | Yes | No | Always transient |
| `step_error` | Non-terminal step or background-work failures | Yes | No | Persistent |
| `error` | Terminal request failure | Yes | No | Persistent |
| `block_output` | Runtime block bookkeeping | No | No | Persistent unless block is transient |
| `router_decision` | Router execution | No | No | Persistent |
| `state_snapshot` | Sequencer step boundaries | No | No | Always transient |

Client and history visibility for conversational item types depends on `agentType`. See [Agent types](/docs/advanced/agent-types).

## Persistence vs visibility

Persistence answers "is the item written to the session item log?" Visibility answers "which consumers can see it?" They are separate.

For example, an item with `agentType: "trace"` is hidden from clients and LLM history even if it is not transient. A `status` item is visible to live clients but is always transient, so it does not replay from persisted session history.

## Keyed snapshots

Items can carry a `key`. A non-transient keyed item represents one logical entity whose latest state replays on reload. The stream can still emit several updates while the request is live, but the persisted session record stores the latest value for that key.

Common examples are component snapshots such as `task-change` or `task-board-meta`.

## Lower-level contracts

Framework contributors should read the repository architecture reference when adding new item types or changing visibility rules:

- [Streaming overview](/docs/streaming/overview)
- [Emitting Items](/docs/streaming/emitting-items)
