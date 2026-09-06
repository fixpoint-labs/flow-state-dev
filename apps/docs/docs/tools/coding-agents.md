---
sidebar_position: 5
sidebar_label: Coding agents
---

# Coding agents

A *harness* is a coding agent driven as a block. You hand it a prompt, it works in
its own agentic loop in a directory you point it at, and it hands back a handle
describing what it did. What it says, what it runs, and what it changes arrive in
your flow's item stream as it goes.

flow-state-dev ships two, and they agree on the handle they return, so a step that
reads the handle can drive either:

| Harness | Package | Runs |
|---|---|---|
| [Claude Code SDK agent](./claude-code-sdk.md) | `@flow-state-dev/claude-code/sdk` | The Claude Code Agent SDK, in your process |
| [Codex SDK agent](./codex.md) | `@flow-state-dev/codex` | The Codex CLI, in a subprocess |

Either one is a block, so a sequencer can step it:

```ts
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const agent = claudeCodeAgent();
// seq.step(agent) with input { prompt: "Tidy the imports in src/." }
```

Swap `claudeCodeAgent` for `codexAgent` and the surrounding step is unchanged.
Where the run works, and which conversation it continues, are
[configuration](#the-prompt-is-the-input-everything-else-is-configuration) you
resolve per run rather than fix when the flow is built. Each page covers the
options that agent takes, the items it emits, and the errors it raises. This page
is what they have in common.

## The handle

Every harness returns the same shape. Code that reads it works the same whichever
agent produced the run:

| Field | What it holds |
|---|---|
| `source` | Which agent and entry point produced the run, as `<package>/<door>` — `claude-code/sdk`, `codex/sdk`. |
| `status` | `running`, `completed`, or `errored`. The schema also admits `dispatched`, which only a fire-and-forget door reports — see [below](#not-every-dispatch-is-a-harness). Switch exhaustively on all four. |
| `sessionId`, `url`, `dispatchedAt` | The run's own id, a link to it when there is one, and when it started. |
| `outcome` | How it ended: `finished`, `stopped-at-limit` (it hit a turn or budget cap), or `failed`. `null` while unknown. |
| `finalMessage` | The last assistant message, or `null`. |
| `usage` | Input and output tokens, or `null` when the agent reports none. |
| `cost` | `{ usd, basis }`, where `basis` says whether the number was `reported` by the agent or `estimated` from the model price table. `null` when neither is known. |

A field the agent did not report reads `null`, with two exceptions: `cost` can
hold a figure derived from the model price table, which `basis: "estimated"`
marks, and a resumed run's `sessionId` starts as the id you asked for, so
`onSession` firing is what tells you the agent confirmed it.

Each harness adds its own fields beside these — Claude Code carries the SDK's
terminal result code and the tool names the run exercised, Codex carries its full
token breakdown and its failure message. Read those when you know which harness
ran. Read the table above when you don't.

The shapes are declared in `@flow-state-dev/core` as `harnessRunInputSchema` and
`harnessRunHandleSchema`, and a block that conforms is a `HarnessBlock`.

## The prompt is the input; everything else is configuration

A harness block takes one thing: the prompt. Where the run works, which
conversation it continues, what model it uses, what it may touch — all of that is
configuration you write when you build the block.

That split is what makes a harness safe to hand to a model as a tool. A field on
the input is a field the model could set, so the values that decide where a run
writes are kept off it.

Those values are resolvers rather than constants, because one flow build serves
many runs:

| Option | What it decides |
|---|---|
| `cwd` | The directory this run works in. |
| `resume` | Which conversation this run continues, or `null` for a fresh one. |
| `onSession` | Called by the harness the moment it names its session, so you can record it. |

`cwd` and `resume` are handed the block's context and nothing else — never the
prompt, so a path or a session id cannot be derived from text a model wrote.

`onSession` fires **during** the run rather than after it, which is why it exists
alongside the handle's own `sessionId`. A run that is cancelled or dies partway
through returns no handle at all, and that is exactly the run you most want to
continue. What the hook reports is the session the agent *confirmed* it is in, so
record what it gives you and treat "the hook never fired" as "there is nothing to
continue".

## A working directory is not a fence

`cwd` says where the run starts. It does not stop the run addressing an absolute
path outside it. Each harness has its own sandbox settings, and those are the
fence.

The same goes for deadlines. Cancelling a run bounds the agent, not what the agent
spawned: a command its process started can outlive the kill.

## Running one under supervision

Driving a harness yourself means deciding where each run works, when it has
finished, and what happens when it fails. If the work arrives as rows on a task
board, [`@flow-state-dev/harness-manager`](/docs/orchestration/harness-manager)
does that part: it derives and provisions a checkout per task, reads the verdict
off the handle before the row settles, parks a run that needs to ask a person
something, and retries the rest. The harness itself is a slot you fill.

## Not every dispatch is a harness

[Claude Code remote dispatch](./claude-code-cli.md) hands a task to a cloud
session and returns. It is fire-and-forget, so there is no outcome, no final
message, no usage and no cost to report — its handle is a dispatch record, not the
handle above, and the harness manager cannot drive it.

## Related

- [Claude Code SDK agent](./claude-code-sdk.md) — the in-process Claude Code harness
- [Codex SDK agent](./codex.md) — the Codex harness
- [Harness manager](/docs/orchestration/harness-manager) — a board worker that supervises either
- [Workspace projection](./workspace.md) — carrying a run's files back to durable storage
- [Work that outlives the turn](/guides/background-work) — running one off the request path
