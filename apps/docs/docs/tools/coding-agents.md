---
sidebar_position: 5
sidebar_label: Coding agents
---

# Coding agents

A *harness* is a coding agent driven as a block. You hand it a prompt, it works in
its own agentic loop in a directory you point it at, and it hands back a handle
describing what it did. What it says, what it runs, and what it changes arrive in
your flow's item stream as it goes.

flow-state-dev ships three, and they agree on the handle they return, so a step
that reads the handle can drive any of them:

| Harness | Package | Runs |
|---|---|---|
| [Claude Code SDK agent](./claude-code-sdk.md) | `@flow-state-dev/claude-code/sdk` | The Claude Code Agent SDK, in your process |
| [Codex SDK agent](./codex.md) | `@flow-state-dev/codex` | The Codex CLI, in a subprocess |
| [Cursor SDK agent](./cursor.md) | `@flow-state-dev/cursor` | Cursor's local runtime, via the Cursor SDK |

Either one is a block, so a sequencer can step it:

```ts
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const agent = claudeCodeAgent();
// seq.step(agent) with input { prompt: "Tidy the imports in src/." }
```

Swap `claudeCodeAgent` for `codexAgent` or `cursorAgent` and the surrounding step
is unchanged.
Where the run works, and which conversation it continues, are
[configuration](#the-prompt-is-the-input-everything-else-is-configuration) you
resolve per run rather than fix when the flow is built. Each page covers the
options that agent takes, the items it emits, and the errors it raises. This page
is what they have in common.

## The handle

Every harness returns the same shape. Code that reads it works the same whichever
agent produced the run:

| Field | What it holds |
|---|---|---|
| `source` | Which agent and entry point produced the run, as `<package>/<door>` — `claude-code/sdk`, `codex/sdk`, `cursor/sdk`. |
| `status` | `running`, `completed`, or `errored`. The schema also admits `dispatched`, for a run that was dispatched and not awaited. None of the harnesses on this page report it, but switch exhaustively on all four. |
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
terminal result code and the tool names the run exercised, Codex and Cursor each
carry their full token breakdown and a failure message. Read those when you know
which harness ran. Read the table above when you don't.

One thing the shared `sessionId` does not settle is what the id names. For Claude
Code and Codex it is the conversation. For Cursor it is the *agent*, which is the
conversation, and each prompt is one run inside it. Either way it is the value
`resume` takes.

The shapes are declared in `@flow-state-dev/core` as `harnessRunInputSchema` and
`harnessRunHandleSchema`, and a block that conforms is a `HarnessBlock`.

A run that fails returns no handle; the block throws. One failure is worth telling
apart from the rest: you asked the agent to continue a conversation with `resume`,
and it doesn't know that conversation. `harnessFailureKind(error)` from
`@flow-state-dev/core` returns `"unknown-conversation"` for that failure and `null`
for every other one, so you can say "the agent refused to continue this
conversation" without matching on any agent's error message. It reads through
wrapped errors, so the error a flow hands you works as well as the agent's own.
Claude Code, Codex and Cursor classify their refusals.

## The run's plan

A coding agent often keeps its own to-do list while it works. A harness that
reports one records it in a resource collection, `observed-plan`, separate from
the run's items. The shape is the same whichever harness wrote it, and it lives
in `@flow-state-dev/core`:

```ts
import { OBSERVED_PLAN, observedPlanCollection, observedPlanItemStateSchema } from "@flow-state-dev/core";
```

Each entry is one to-do item, keyed under the request and the run that wrote it,
with its wording (`title`), the status the harness last confirmed (`status`), the
one before (`previousStatus`), and how the last attempt to change it settled
(`lastOutcome`). Every field can be `null`. A status is the harness's own word for
it, so read it as text rather than matching a fixed list.

Entries stream to an open page as they change, so a plan you show beside a
session stays in step while the run works.

A run's plan is a record of what the agent planned, not a work queue. Nothing in
it starts work, and writing to it hands the agent nothing.

Not every harness reports a plan. Read the session's resource manifest first. If
it doesn't list `observed-plan`, the harness records none, and a reader should say
so rather than show an empty list.

A Codex block is one: Codex doesn't keep a to-do list in the version
`@flow-state-dev/codex` supports, so its manifest doesn't list `observed-plan`.

Beside the entries, each run has a list marker in `observed-plan-list`, keyed by
the run. It says whether the run's plan is `complete`, still `writing`, or
`incomplete`, how many places it holds, and why it's incomplete. Read it before
the entries:

- `complete` with no places means the agent reported an empty list.
- `incomplete`, or `writing` once the run has ended, means a write failed
  partway. Show what's there as possibly incomplete, with the reason, not as the
  plan.
- With a count, show only the places below it.
- No marker and no entries means the run reported no plan.

To record a plan from a harness of your own, declare `observedPlanCollection` and
`observedPlanListCollection` on the block. If your agent reports its whole list
each time, with no ids, hand it to `replacePlanList(plan, marker, runNamespace,
items)`: it keys entries by place, keeps an entry's earlier status when its
wording is unchanged, removes entries past the end, and writes the marker. It
never throws; a list it can't store in full leaves the marker `incomplete` and
the run carries on. Call it from one writer per run. If your agent reports items
by id, upsert entries under `<requestId>/<run>/<item id>` and mark the run
`incomplete` when a write fails.

## Subscription usage

A coding agent on a subscription plan has limits per time window, and a run
fails once a window runs out. A *usage reader* asks the agent how much of each
window is used, without a run. The shapes live in `@flow-state-dev/core`, so a
page or a worker reads every agent's usage the same way:

```ts
import type { HarnessUsageReader, HarnessUsageReading, HarnessUsageWindow } from "@flow-state-dev/core/types";
import { harnessUsageWindowSchema } from "@flow-state-dev/core";
```

A reader is `(options?: { signal?: AbortSignal }) => Promise<HarnessUsageReading>`.
A reading is one of four:

| `status` | Carries |
|---|---|
| `windows` | `windows`, plus `plan` and `accountId`, each `null` when the agent didn't name one. |
| `api-key` | `reason`. The agent runs on an API key, which has no subscription limit. |
| `signed-out` | `reason`. Nobody is signed in. |
| `unavailable` | `reason`. The read couldn't be made. |

Each window has an `id` unique within the reading, the vendor's `label` for its
limit, its length in `minutes`, `usedPercent` from 0 to 100, and `resetsAt` in
epoch ms. `label`, `minutes` and `resetsAt` are `null` when the vendor didn't
say. The numbers are the vendor's own, unconverted. Only `windows` carries a
number: show the `reason` for the other three, never 0%.

A reader returns those states rather than throwing. Codex ships one,
[`readCodexUsage`](./codex.md#reading-usage-left). To keep readings and serve
them with their age, hand your readers to the
[harness manager's usage query](/docs/orchestration/harness-manager#subscription-usage).

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
|---|---|---|
| `cwd` | The directory this run works in. |
| `resume` | Which conversation this run continues, or `null` for a fresh one. |
| `onSession` | Called by the harness the moment it names its session, so you can record it. |
| `model` | Which model this run uses, in the harness's own ids. A fixed id works too. |

`cwd`, `resume` and `model` are handed the block's context and nothing else — never the
prompt, so a path, a session id or a model cannot be derived from text a model wrote.

`model` is how one flow runs different models for different users or sessions:
read the id from session state, the way `resume` reads the conversation. The
harness takes it on a fresh run and a resumed one alike. Return `null` to leave
the harness on its default. Each harness also has its own model setting in its
vendor-shaped options (Codex's `thread.model`, Cursor's `agent.model`); setting
both is refused when the block is built.

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

The environment is open by default too. A Claude Code or Codex run started
without an `env` (`client.env` for Codex) inherits the server's whole
`process.env`, secrets included. `harnessEnv({ pass })` from
`@flow-state-dev/core` passes only the variables you name; the
[Claude Code](./claude-code-sdk.md#configuring-the-run) and
[Codex](./codex.md#environment-variables) pages show where it goes. The Cursor
adapter has no `env` option, so `harnessEnv` doesn't apply to it.

## Running one under supervision

Driving a harness yourself means deciding where each run works, when it has
finished, and what happens when it fails. If the work arrives as rows on a task
board, [`@flow-state-dev/harness-manager`](/docs/orchestration/harness-manager)
does that part: it derives and provisions a checkout per task, reads the verdict
off the handle before the row settles, parks a run that needs to ask a person
something, and retries the rest. The harness itself is a slot you fill.

## Related

- [Claude Code SDK agent](./claude-code-sdk.md) — the in-process Claude Code harness
- [Codex SDK agent](./codex.md) — the Codex harness
- [Cursor SDK agent](./cursor.md) — the Cursor harness
- [Harness manager](/docs/orchestration/harness-manager) — a board worker that supervises either
- [Workspace projection](./workspace.md) — carrying a run's files back to durable storage
- [Work that outlives the turn](/guides/background-work) — running one off the request path
