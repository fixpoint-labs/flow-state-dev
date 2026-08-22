# @flow-state-dev/claude-code

Claude Code integration for flow-state-dev. The `/sdk` entry runs a Claude Code
agent in-process and streams its work through the flow's item stream, backed by
the optional `@anthropic-ai/claude-agent-sdk` peer dependency.

## Installation

```bash
pnpm add @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk
```

## Quick start

Attach the capability so a generator can hand work to the agent, or use the block
directly as a sequencer step:

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCodeAgentCapability } from "@flow-state-dev/claude-code/sdk";

const orchestrator = generator({
  name: "orchestrator",
  model: "openai/gpt-5.4-mini",
  uses: [createClaudeCodeAgentCapability()],
});
```

The agent's messages, reasoning, tool calls, and sub-agents become flow-state-dev
items as it runs, and its session persists across requests. See the
[Claude Code SDK agent guide](https://flow-state.dev/docs/tools/claude-code-sdk)
for the full surface.

### Running as detached background work

The SDK agent keeps its own session state — `sdkSessionId` (the run it resumes)
and `sdkAgentRuns` (the handles it has returned). Pass `detached: true` to run it
as background work instead, which switches that off:

```ts
claudeCodeAgent({ detached: true });
```

Nothing is declared, read, or written, and the SDK is handed no `resume`, so each
run starts fresh. Use it when the agent runs as background work on a task board:
those workers share one flow, so the board refuses one whose block declares
session state. The run's own history is the workstream's item stream instead.

The returned handle still carries the SDK `sessionId`, and as a worker's output
it is persisted with the task — the option governs session state and resume, not
the result.

`createClaudeCodeAgentCapability({ detached: true })` takes the same option, and
passing it is required rather than tidy: a capability declares the schema through
a channel the board's refusal cannot see.

### Recording what a run did

`recordWork: true` records the run's file operations and its own to-do list as
state you can read afterwards. Off by default; on, the agent declares three
resource collections and writes into them as it goes:

| Accessor | One entry per |
|----------|---------------|
| `observed-file-ops` | path the run's file-writing/editing tools touched — `lastKind`, `outcome` (`pending`/`applied`/`failed`), `lastTouchedAt`, `appliedCount`. Paths, never contents |
| `observed-plan` | to-do item the run kept — `title`, `status`, `previousStatus`, `lastOutcome` |
| `observed-gaps` | mutation the recorder understood and could not record — `kind` (`file`/`plan`/`run`) says which record it stands in for, plus the reason and the raw path |

```ts
claudeCodeAgent({ detached: true, recordWork: true });
```

Entries are keyed as `<requestId>/<invocation>`, so a workstream reused across
runs — and a request that runs the agent more than once — both answer per run.
All three declare client state reads, so
`GET /sessions/:id/resources/observed-file-ops?topicPrefix=observed-file-ops/<requestId>/`
returns them; each row's payload is on `clientData`. Follow `nextCursor` — the
route pages.

The request id in that prefix is **percent-escaped** into one key segment, so a
filter built from a raw id only matches when the id needs no escaping. Escape
`%` first, then `/`, `\` and control characters, and `..` as `%2E%2E`; every
other id — brackets, dots and `.`/`...` included — is used verbatim. An id with
no such characters, which is the common case, needs nothing.

`appliedCount` counts only the operations on that path the harness confirmed
applied, not the attempts: each one is recorded twice, once when the call is
seen and once when its result arrives. `outcome` beside it describes only the
last settlement, so the count is what says how many of a path's touches landed.
`0` and `null` are different answers — `0` means the run touched the path and
nothing applied, `null` means the row was written before the field existed.

The file record covers tool-driven operations only. A run that edits through the
shell makes no file-tool call, so nothing is recorded for it. Recording never
fails the run: what it cannot handle becomes a gap row.

`createClaudeCodeAgentCapability({ recordWork: true })` takes the same option and
needs it — the capability declares the collections itself, because a block in a
capability's `tools` contributes no resource declarations to the flow.

## Running tests

```bash
pnpm --filter @flow-state-dev/claude-code test
```
