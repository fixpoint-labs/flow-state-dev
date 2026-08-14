# @flow-state-dev/claude-code

Claude Code integration for flow-state-dev, with two entry points. The `/cli`
entry shells out to your local `claude` CLI (no Anthropic SDK dependency), either
dispatching a cloud coding task or running the agent locally and waiting for it.
The `/sdk` entry runs a Claude Code agent in-process and streams its work through
the flow's item stream, backed by the optional `@anthropic-ai/claude-agent-sdk`
peer dependency.

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

## Running the agent locally and waiting for it

Cloud dispatch is one of two things the `claude` binary can do. The other is a
headless local run: point the agent at a directory, block until it finishes, and
read what it cost. That is `runClaudeHeadless` — a plain async function, not a
block, so anything can call it, inside a flow or not.

```ts
import { runClaudeHeadless } from "@flow-state-dev/claude-code/cli";

const run = await runClaudeHeadless({
  prompt: "Fix the failing test in src/parser.ts.",
  cwd: "/path/to/checkout",
  permissionMode: "acceptEdits", // nothing can answer a prompt with no terminal
  timeoutMs: 30 * 60 * 1000,
});

if (run.ok) console.log(run.finalMessage, run.costUsd, run.sessionId);
else console.error(run.error);
```

It **settles rather than throws**. A missing binary, a timeout, a crash, and a
non-zero exit all come back as `ok: false` with a reason — so if you keep a
ledger or a retry budget off the return value, you never lose a record to an
exception. `costUsd` is populated on failed runs too; the tokens were spent
either way. Unreadable stdout on a clean exit is a success with no cost, not a
failure: the envelope shape belongs to the CLI, and a parser that hard-failed on
it would turn a cosmetic vendor change into a stalled caller.

`--model` and `--permission-mode` are passed only when you set them, so the CLI's
own defaults apply otherwise. `exec` takes the same `ClaudeCliExec` seam as the
rest of this entry, so tests spawn nothing.

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

## Choosing `/cli` or `/sdk`

| | `/cli` | `/sdk` |
|--|--------|--------|
| Execution | Fire-and-forget cloud session | In-process agent |
| Dependency | None (shells out to `claude`) | Optional `@anthropic-ai/claude-agent-sdk` peer |
| Auth | claude.ai subscription | Anthropic credentials |
| Progress | Watch via `/tasks`, claude.ai, mobile | Streamed live as flow-state-dev items |
| Session | Cloud session handle | Persistent, resumed across requests |
| Reach for it when | Offloading long autonomous work | A real agent in the loop, observed step by step |

## Running tests

```bash
pnpm --filter @flow-state-dev/claude-code test
```
