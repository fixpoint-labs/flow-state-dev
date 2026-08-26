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
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const CHECKOUT_ROOT = "/var/agent-checkouts";

claudeCodeAgent({
  // A fresh directory per run, created by the server. No caller input reaches
  // the path.
  cwd: async () => {
    // `mkdtemp` creates the leaf, not the parent — ENOENT if the root is
    // missing, which on a fresh machine it is.
    await mkdir(CHECKOUT_ROOT, { recursive: true });
    return mkdtemp(join(CHECKOUT_ROOT, "run-"));
  },
  // A fresh directory per run needs a fresh conversation to match.
  detached: true,
});
```

A function, not a string: one flow build serves many runs, so it resolves per
invocation. It may return a promise, as here.

`detached: true` belongs in this example rather than beside it. By default the
agent hands the SDK a `resume` handle from the previous run in the same
session; combined with `mkdtemp`, the second invocation resumes a conversation
started in a directory that has nothing to do with the empty tree it now runs
in. Start fresh per run, as here, or keep a stable directory when you want
resume — a per-run directory with resume left on is the surprising combination.

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
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

function segment(value: string | undefined): string {
  // Absence is `0`; a present value is `1` plus a SHA-256 digest of its UTF-16
  // code units — a fixed 65 characters, so a long id cannot overflow the
  // 255-character filename limit.
  //
  // Digest the CODE UNITS, not the UTF-8 bytes: UTF-8 cannot represent a lone
  // surrogate, so hashing `value` directly maps "\ud800", "\ud801" and a
  // literal "�" onto one digest.
  return value === undefined
    ? "0"
    : `1${createHash("sha256").update(Buffer.from(value, "utf16le")).digest("hex")}`;
}

function checkoutFor(tenantId: string | undefined, key: string): string {
  const dir = join(CHECKOUT_ROOT, segment(tenantId), segment(key));
  // Belt and braces. Encoding already makes escape impossible; this costs a
  // line and fails loudly if the encoding is ever swapped for something weaker.
  const rel = relative(CHECKOUT_ROOT, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`refusing a checkout outside ${CHECKOUT_ROOT}`);
  }
  return dir;
}
```

`checkoutFor` derives a path and nothing more; provisioning is the resolver's
job. Wire both halves of the identity in — the authenticated tenant is on
`ctx.session.identity.tenantId`, and `ctx.session.identity.id` stays the bare
session id two tenants can share — and create the directory before handing it
over:

```ts
const agent = claudeCodeAgent({
  cwd: async (_input, ctx) => {
    const dir = checkoutFor(
      ctx.session.identity.tenantId,
      ctx.session.identity.id,
    );
    // The SDK spawns into this directory, so it has to exist or the spawn
    // fails with ENOENT. `recursive` makes reuse idempotent.
    await mkdir(dir, { recursive: true });
    return dir;
  },
});
```

A reused checkout is shared mutable state. Actions run concurrently unless you
say otherwise, and the resolver above creates the directory without claiming it,
so two runs for one session get the same tree and race in it. Declare a
concurrency policy on the action that runs the agent — `concurrency: "queue"`
serializes on the session, which is the same value the checkout is derived from,
so one run finishes before the next starts (`"reject"` if a second request
should be dropped instead).

A policy arbitrates *dispatches*, which leaves two cases open. A generator's
tool calls in one model step run concurrently, so a block exposed as a
model-facing tool can be invoked twice inside a single dispatch, where the
policy never sees it. And the arbiter is a map in the running process, so
external workers are not arbitrated either. The recipe is safe for a
single-instance host running the agent as a step, one invocation per run; give
the agent a fresh directory per run otherwise.

Encoding rather than validating is the whole point, and it is worth being
explicit about why. A validating grammar has to enumerate every way a string can
misbehave as a path, and that list is longer than it looks: separators and `..`
are the obvious two, but Windows also strips trailing dots (so `acme` and `acme.`
are one directory), reserves `CON`, `PRN`, `AUX`, `NUL`, `COM1`…`LPT9` as device
names that cannot be directories at all, and folds case. Every one of those is a
value two different tenants could hold.

A derived segment sidesteps the whole list: distinct ids give distinct
directories, and the output alphabet contains nothing any filesystem treats
specially.

**A digest rather than a reversible encoding, because the output has to be
bounded.** Filenames stop at 255 characters, and anything that preserves its
input grows with it — hex of UTF-16 code units runs to four characters each, so
a 64-character session id produced a 257-character component and `mkdir` failed
`ENAMETOOLONG`. A digest is a fixed 65 characters for any input. The honest
trade is that distinctness now rests on SHA-256 rather than on arithmetic, and
the path no longer tells you whose checkout it is. **Do not truncate instead** —
trimming a reversible encoding to fit maps two long ids onto one segment, which
is the collision the derivation exists to prevent.

**Hash the code units, not the UTF-8 bytes.** UTF-8 cannot represent a lone
surrogate — a legal JS string that JSON will carry — so anything transcoding
through it maps `"\ud800"`, `"\ud801"` and a literal `"�"` onto one value.

Give each value its own segment; concatenating them into one string brings back
the ambiguity the tenant is there to remove.

**Encode whether a value is there, not just what it is.** A missing tenant is
tempting to fill in with a stand-in — `tenantId ?? "default"` — but a stand-in
is a value some tenant may legitimately hold, and then an un-tenanted host and
that tenant address one directory. The tag does the same job without the
collision, and keeps every segment non-empty, which matters because `join`
discards an empty one.

If your key is already something you control and know to be safe — a numeric job
id, a UUID — the encoding is close to a no-op and you can skip it. Encode by
default anyway: the moment the key starts coming from somewhere else, the rules
you would have to remember are a list nobody finishes.

Prefer a key your own code assigned over one that arrived with the request.

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
