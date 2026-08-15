# @flow-state-dev/claude-code

Claude Code integration for flow-state-dev, with two entry points. The `/cli`
entry shells out to your local `claude` CLI (no Anthropic SDK dependency) to
dispatch a cloud coding task. The `/sdk` entry runs Claude Code in-process,
backed by the optional `@anthropic-ai/claude-agent-sdk` peer dependency — either
as a flow block that streams the agent's work through the item stream, or as a
plain headless run you point at a directory and wait for.

## Installation

```bash
pnpm add @flow-state-dev/claude-code
```

The host machine needs the [Claude Code CLI](https://code.claude.com/docs) installed
and signed in to claude.ai (cloud dispatch requires subscription auth, not an API key).

## Quick start

A capability is a reusable bundle you attach to a block. Installing this one is
the host's explicit opt-in to letting the process run `claude`:

```ts
import { generator } from "@flow-state-dev/core";
import { createClaudeCliCapability } from "@flow-state-dev/claude-code/cli";

const planner = generator({
  name: "planner",
  model: "openai/gpt-5.4-mini",
  uses: [createClaudeCliCapability()],
});
```

The generator can now call the dispatch tool. To dispatch deterministically
instead, use the handler directly as a sequencer step:

```ts
import { claudeRemoteDispatch } from "@flow-state-dev/claude-code/cli";

const dispatch = claudeRemoteDispatch();
// seq.step(dispatch) with input { instructions: "..." }
```

## How it works (CLI)

`claude --remote "<instructions>"` creates a cloud session on claude.ai that
clones your repo's GitHub remote at the current branch (push first — the cloud VM
clones from GitHub, not your working tree). The block parses the returned session
URL, persists a handle, and returns it.

It is **fire-and-forget**: the CLI exposes no headless way to poll or stream
cloud-task progress today, so the block does not wait or poll. Watch progress via
`/tasks` in the CLI, claude.ai, or the mobile app.

## Trust model

Nothing shells out unless the host opts in by installing the capability (or
passing a resolver). `resolveClaudeCli` supplies the binary path, working
directory, environment, and the exec function — so the binary location is
host-controlled and the subprocess is mockable in tests.

### Dispatching `--remote` needs a TTY

`claude --remote` refuses to run unless stdout is a TTY, so the default
`resolveClaudeCli` (a bare `spawn`) cannot dispatch — it exits 1 with
"--remote requires an interactive terminal". Pass `resolvePtyClaudeCli`, which
runs `claude` under `script(1)` (a pseudo-terminal) and scrubs inherited
`CLAUDE_*` / `ANTHROPIC_API_KEY` state so the dispatch authenticates as your
logged-in user rather than tripping a "Detected a custom API key" prompt:

```ts
import { claudeRemoteDispatch, resolvePtyClaudeCli } from "@flow-state-dev/claude-code/cli";

const dispatch = claudeRemoteDispatch({ resolveClaudeCli: resolvePtyClaudeCli });
```

Requires `script(1)` (present on macOS and Linux).

## Session state

Each dispatch appends a handle to `claudeRemoteTasks` in session state:

```ts
type ClaudeRemoteHandle = {
  source: "cli-remote";
  status: "dispatched";
  sessionId: string | null;   // parsed from CLI output when present
  url: string | null;         // claude.ai session URL when present
  instructions: string;
  dispatchedAt: number;
  raw: string;                // verbatim CLI stdout
};
```

A later request reads `ctx.session.state.claudeRemoteTasks` to reference prior
dispatches.

## Limitations

- No headless polling/streaming of *cloud* task progress (CLI limitation).
- Dispatches the current branch as pushed to GitHub; push local commits first.
- The exact `claude --remote` stdout shape is undocumented; the parser is
  defensive and falls back to retaining raw output if it can't find a URL.

## Quick start (SDK)

The `/sdk` entry runs a Claude Code agent in-process. Install the optional peer:

```bash
pnpm add @flow-state-dev/claude-code @anthropic-ai/claude-agent-sdk
```

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

## Running the agent locally and waiting for it

Sometimes you do not want a flow at all: you want the agent to work in a
directory until it is done, and then to find out what happened and what it cost.
That is `runClaudeHeadless` — a plain async function with no `BlockContext`, no
session state, and no emitted items, so anything can call it.

```ts
import { runClaudeHeadless } from "@flow-state-dev/claude-code/sdk";

const run = await runClaudeHeadless({
  prompt: "Fix the failing test in src/parser.ts.",
  cwd: "/path/to/checkout",
  permissionMode: "acceptEdits", // nothing can answer a prompt with no terminal
  timeoutMs: 30 * 60 * 1000,
});

if (run.ok) console.log(run.finalMessage, run.costUsd, run.usage, run.sessionId);
else console.error(run.error, run.subtype);
```

It **settles rather than throws**. An uninstalled SDK, a timeout, a crash
mid-run, and a run that ends on an error subtype all come back as `ok: false`
with a reason — so if you keep a ledger or a retry budget off the return value,
you never lose a record to an exception.

`costUsd` and `usage` come from the run's terminal result. A run that ends on an
error subtype still reports them — the tokens were spent either way — but a
timeout or a mid-run crash never gets that result, so both come back `null`. The
spend was real; the SDK just never said how much. Total those runs as unknown,
not as free.

`timeoutMs` bounds *the call*, not the agent. On the deadline the run is aborted
and, where the SDK exposes a way to, closed — then the call returns whether or
not the run acknowledged. An agent that ignores both is left running, and
`error` says so ("…was abandoned before it acknowledged the stop, so the agent
may still be running") rather than claiming it was killed. If you cannot afford
a stray agent process, treat that wording as an alert.

`subtype` is the run's own account of how it ended, so you can tell a ceiling you
set (`error_max_turns`, `error_max_budget_usd`) from a failure you cannot raise
your way out of (`error_during_execution`). A subtype this package does not
recognize is treated as a failure, never as a success, and the raw value is kept
in `error`.

Two defaults are worth knowing, because they are not the SDK's:

- **`settingSources` defaults to `["user", "project", "local"]`.** The SDK loads
  no filesystem settings unless asked, which means no `CLAUDE.md`, no project
  settings and no project skills — fine for an isolated one-shot, wrong for an
  agent working in your repository. Pass `[]` to get the isolated behaviour back.
- **`systemPrompt` defaults to Claude Code's own preset.** Omitting it in the SDK
  gives an *empty* system prompt. Pass a string to replace the prompt, or
  `{ type: "preset", preset: "claude_code", append }` to extend it.

`model`, `maxTurns` and `maxBudgetUsd` are passed only when you set them, so the
vendor's own defaults apply otherwise. `resolveAgent` is the same seam the agent
block uses, so tests run nothing.

## Choosing `/cli` or `/sdk`

| | `/cli` | `/sdk` |
|--|--------|--------|
| Execution | Fire-and-forget cloud session | In-process agent (flow block or headless run) |
| Dependency | None (shells out to `claude`) | Optional `@anthropic-ai/claude-agent-sdk` peer |
| Auth | claude.ai subscription | Anthropic credentials |
| Progress | Watch via `/tasks`, claude.ai, mobile | Streamed live as flow-state-dev items |
| Session | Cloud session handle | Persistent, resumed across requests |
| Reach for it when | Offloading long autonomous work | A real agent in the loop, observed step by step — or a blocking local run you wait on |

## Running tests

```bash
pnpm --filter @flow-state-dev/claude-code test
```
