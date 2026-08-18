---
sidebar_position: 6
sidebar_label: Claude Code (SDK agent)
---

# Claude Code SDK agent

`@flow-state-dev/claude-code/sdk` — run a Claude Code agent in-process and watch
it work through your flow's item stream. The agent's messages, reasoning, tool
calls, and sub-agents become flow-state-dev items as they happen, and its session
carries across requests.

This is the companion to [Claude Code remote dispatch](./claude-code-cli.md). That
page hands a task to a cloud session and returns a handle. This page runs the
agent locally, in your process, and streams everything it does.

## When to use it

Reach for this when a flow needs a real agent in the loop, not a fire-and-forget
dispatch: an assistant that reads and edits files, runs commands, searches the
web, and reports back as it goes, with each step visible in the devtool. Because
the run is a block, a sequencer can chain it, a router can branch on its result,
and the next request can resume the same agent session.

The agent owns its own loop. flow-state-dev does not drive it step by step or
re-implement its tools. It runs the [Claude Code Agent
SDK](https://code.claude.com/docs/en/agent-sdk/typescript), observes the stream,
and translates each message into a canonical item. You get the SDK's full tool
suite and agentic behavior, with flow-state-dev's state, provenance, and
streaming wrapped around it.

## Installation

The SDK is an optional peer dependency, so the package stays installable for the
`/cli` path without it:

```bash
pnpm add @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk
```

The Agent SDK bundles its own binary, so there is no separate CLI to install. It
needs Anthropic credentials in the environment at runtime.

## Quick start

A capability is a reusable bundle you attach to a block. Installing this one lets
a generator hand work to the agent as a tool:

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCodeAgentCapability } from "@flow-state-dev/claude-code/sdk";

const orchestrator = generator({
  name: "orchestrator",
  model: "openai/gpt-5.4-mini",
  uses: [createClaudeCodeAgentCapability()],
});
```

## As a sequencer step

When the host decides to run the agent (rather than letting a model choose), use
the block directly:

```ts
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const agent = claudeCodeAgent({
  systemPrompt: "You are a careful refactoring assistant.",
  allowedTools: ["Read", "Grep", "Edit"],
});
// seq.step(agent) with input { prompt: "Tidy the imports in src/." }
```

The block returns a handle describing the run: its terminal status, the final
assistant message, the tools it used, and usage when the SDK reports it.

## What it emits

As the agent runs, the block translates the SDK stream into items:

| SDK output | flow-state-dev item |
|------------|---------------------|
| Assistant text | `message` (streamed token by token when partial messages are on) |
| Extended thinking | `reasoning` |
| Tool call and its result | `tool_output`, with the tool call's id, name, and arguments |
| Sub-agent (`Task`/`Agent`) | a `container` grouping the sub-agent's items |
| System init, history compaction | transient `status` |
| Errors | `error` |

Every item carries provenance, so the devtool shows the full trace of what the
agent did.

## Session continuity

The block persists the SDK session id in session state and resumes it on the next
request, so a follow-up prompt continues the same conversation:

```ts
const runs = ctx.session.state.sdkAgentRuns ?? [];
```

Continuity runs through a `BindingProvider`, the framework's mechanism for holding
a live handle across requests rather than a parallel store. The default provider
is thin because the SDK resumes cheaply by id; pass your own to hold a heavier
resource (an open connection, for example).

### Turning it off for background work

A **workstream** is a child session dedicated to one background job, running
outside the request that started it. If you dispatch the agent into one, set
`sessionState: false`:

```ts
const agent = claudeCodeAgent({ sessionState: false });
```

Each job is then one run. Nothing is written to session state, and no prior SDK
conversation is resumed — a second job addressed to the same workstream begins a
new agent run. What the run did is still recorded: the workstream's own item
stream holds its messages, reasoning, and tool calls in order, which is what you
read the run back from.

**The session id does not disappear.** The option governs session state and
automatic resume, not the run's own result: the handle the block returns still
carries the SDK `sessionId` it observed. When the agent runs as a task-board
worker, that handle is the worker's output, and the board writes the output onto
the task when it settles — so the id is persisted there. Worth knowing if you are
reasoning about data retention, or if you plan to resume a run by hand later.

The option is also required rather than optional there. Background workers share
one flow, so two of them declaring the same session-state key would overwrite
each other, and the task board refuses to build a background worker that declares
session state.

That refusal sees the worker block and the blocks composed inside it. It does
**not** see a session-state schema contributed by a capability, which reaches a
block through a separate channel that leaves no mark on the block itself. So a
worker can be accepted while still carrying session state that way. If you attach
this agent as a capability, pass the option there too — it takes the same one:

```ts
createClaudeCodeAgentCapability({ sessionState: false });
```

See [Background work](../server/background-work.md) for how a workstream is set
up and read back.

## Recording what the run did

The item stream tells you what the agent said. `recordWork: true` also records
what it did, as ordinary state you can query afterwards.

```ts
const agent = claudeCodeAgent({
  sessionState: false,
  recordWork: true,
});
```

It is off by default. Turned on, the agent declares three **resource
collections** — a resource collection is a keyed set of small state records the
framework stores and serves for you — and writes into them as the run goes:

| Collection | One entry per |
|---|---|
| `observed-file-ops` | path the run's file-writing and file-editing tools touched: how it was touched, when, and whether the attempt applied |
| `observed-plan` | item on the run's own to-do list: its wording, its current status, and the status before that |
| `observed-gaps` | thing the recorder understood and could not record, with the reason |

Entries are keyed as `<requestId>/<invocation>`. A workstream can host several
runs over its life, and a single request can itself run the agent more than once
— a generator holding it as a tool can call it repeatedly — so both halves are
needed to keep one run's answer from becoming somebody else's.

### Reading it back

Both records come back over the resource route, one page at a time. Scope the
read with `topicPrefix`, and follow `nextCursor` while one is returned:

```
GET /sessions/<workstreamId>/resources/observed-file-ops?topicPrefix=observed-file-ops/<requestId>/

{ "items": [
  { "topic": "<requestId>/<invocation>/work/repo/src/checkout.ts",
    "storageKey": "observed-file-ops/<requestId>/<invocation>/work/repo/src/checkout.ts",
    "clientData": { "lastKind": "edited", "outcome": "applied",
                    "lastTouchedAt": 1787021400123 } }
] }
```

Prefixing with the request id gives you everything that request did; adding the
invocation narrows it to one run.

Each row's payload is on `clientData`. `outcome` has three values, not two:
`pending` while a mutation has been seen and not yet settled, then `applied` or
`failed`. A run that is killed mid-flight leaves its unsettled entries as
`pending`, which is the honest answer about a write nobody confirmed.

The plan record reads the same way, from `observed-plan`. A to-do item's status
is the harness's own word for it, and stays empty until the harness reports one.

### What the file record is, and what it isn't

It is a log of the file operations you saw the agent's file tools perform. It is
not an index of everything that changed on disk. A run that edits a file through
the shell — a `sed -i`, a redirect, a `mv`, a formatter — makes no file-tool
call, so nothing is recorded and that file does not appear. If you need an
authoritative list of what changed, compare the working tree yourself.

Paths are recorded, contents are not. The record points at your source; it does
not hold a second copy of it.

### Gaps

Recording never interferes with the run. Anything the recorder cannot handle is
skipped, the run carries on, and the skip lands in `observed-gaps` with the
reason and the raw path where there was one.

That collection is the difference between "this file was never touched" and "we
saw it and could not record it". Read it alongside the other two whenever a
record looks thinner than you expected.

### The plan is not a work queue

A run's to-do list goes into its own record, deliberately separate from the task
board that dispatched the run. An agent that decides mid-run to do five more
things writes five to-do items and starts nothing. Picking one up is a separate,
deliberate act.

Attaching the agent as a capability takes the same option, and needs it — the
capability declares the collections itself:

```ts
createClaudeCodeAgentCapability({ sessionState: false, recordWork: true });
```

See [Resource collections](../resources/collections.md) for how collections are
stored, paged, and made visible to clients.

## Tool approval

By default the agent governs its own tools through the SDK's `permissionMode`. To
gate a tool call from your flow, pass `onToolApproval`: it receives each request
and returns allow or deny, and the decision surfaces as a status item.

```ts
const agent = claudeCodeAgent({
  permissionMode: "default",
  onToolApproval: async (req) => {
    if (req.toolName === "Bash") return { decision: "deny", message: "no shell" };
    return { decision: "allow" };
  },
});
```

This is the interim story. Routing approvals through flow-state-dev's own
human-in-the-loop suspend and resume is a follow-up; `onToolApproval` is the seam
that work will plug into.

## Error handling

| Situation | Behavior |
|-----------|----------|
| `@anthropic-ai/claude-agent-sdk` not installed | Throws `ClaudeAgentSdkNotInstalledError` with an install hint. |
| The agent finishes with an error result (hit max turns, budget, or a runtime error) | Treated as an outcome: the handle's `status` is `"errored"` with the SDK's `resultSubtype`, and an `error` item is emitted. No throw. |
| The SDK throws mid-stream | Wrapped in `ClaudeAgentRunError` and rethrown after an `error` item. |
| A tool or sub-agent is still open when the stream ends | Its item is marked `incomplete`. |
| Empty prompt | Validation error before the agent starts. |

## Limitations

This version runs the agent and observes it. It does not let flow-state-dev drive
the SDK loop one step at a time, register flow-state-dev blocks as tools the agent
can call, or map sub-agents to nested flow-state-dev generators. Tool approval
degrades to the SDK's own mechanism until native human-in-the-loop lands. Prompts
are strings, not streamed input.

See also: [Tools overview](./overview.md) and [Claude Code remote
dispatch](./claude-code-cli.md) for the fire-and-forget cloud alternative.
