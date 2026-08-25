# @flow-state-dev/claude-code

Claude Code integration for flow-state-dev, with two entry points. The `/cli`
entry dispatches a cloud coding task by shelling out to your local `claude` CLI
(no Anthropic SDK dependency). The `/sdk` entry runs a Claude Code agent
in-process and streams its work through the flow's item stream, backed by the
optional `@anthropic-ai/claude-agent-sdk` peer dependency.

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

### Running as detached background work (`/sdk`)

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

### Giving a run its own working directory (`/sdk`)

By default a run works in whatever directory the server process is running in.
Pass `cwd` to point it somewhere else:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const CHECKOUT_ROOT = "/var/agent-checkouts";

claudeCodeAgent({
  // A fresh directory per run, created by the server. No caller input reaches
  // the path.
  cwd: () => mkdtemp(join(CHECKOUT_ROOT, "run-")),
});
```

A function, not a string: one flow build serves many runs, so it resolves per
invocation. It may return a promise, as here.

The run's file tools address relative paths inside that directory, and so does
`recordWork`'s record of what the run touched. It is a working directory, not a
boundary — a run can still reach an absolute path outside it, and that operation
is recorded at the path it reached.

#### Reusing a directory across runs

A throwaway directory is the easy case. If you want runs that belong together to
share a checkout — a retry picking up where the last attempt stopped, say — the
path has to be derived from something stable, and **that is where the sharp
edges are**:

```ts
import { isAbsolute, join, relative } from "node:path";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeSegment(value: string): string {
  // Rejected, never stripped: stripping maps two distinct values onto one
  // directory, which silently gives two runs the same checkout.
  if (!SAFE_SEGMENT.test(value)) throw new Error(`unusable path segment: ${value}`);
  return value;
}

function checkoutFor(tenantId: string | undefined, key: string): string {
  // A separate segment each. Concatenating them re-creates the ambiguity the
  // tenant is here to remove.
  const dir = join(CHECKOUT_ROOT, safeSegment(tenantId ?? "default"), safeSegment(key));
  // `relative`, not a string prefix: `join` uses the platform separator, so a
  // check against a literal "/" rejects every valid value on Windows.
  const rel = relative(CHECKOUT_ROOT, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`refusing a checkout outside ${CHECKOUT_ROOT}`);
  }
  return dir;
}
```

Three rules, and each of them exists because of a way this goes wrong:

- **Validate every part as a single path segment.** Session ids and request ids
  both arrive from the caller, so a value like `../../server-repo` would send the
  run somewhere you did not choose (BP-031).
- **Include the tenant when you have one.** Two tenants can hold the same session
  id — the framework namespaces its own session storage by tenant for exactly
  that reason — so a path built from the session alone puts two tenants in one
  directory.
- **Confirm the result is still inside your root**, with `relative` rather than a
  string comparison.

Prefer a key you control over one that arrives with the request. The safest
version of this is a value your own code assigned — a job id from your queue, a
row id from your database — with the guards above as the backstop rather than
the only defence.

Full behaviour, including what an empty or symlinked directory does, is on the
`cwd` option's own docs in `src/sdk/agent.ts` and in the
[SDK agent guide](https://flow-state.dev/docs/tools/claude-code-sdk#where-the-run-works).

### Recording what a run did (`/sdk`)

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

## Limitations

- No headless polling/streaming of cloud-task progress (CLI limitation).
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
| As background work | Already fire-and-forget | Task-board worker with `detached: true`; the workstream's item stream is the run's record |
| Reach for it when | Offloading long autonomous work | A real agent in the loop, observed step by step |

## Running tests

```bash
pnpm --filter @flow-state-dev/claude-code test
```
