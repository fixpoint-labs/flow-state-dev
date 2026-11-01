---
sidebar_position: 7
sidebar_label: Claude Code (SDK agent)
---

# Claude Code SDK agent

`@flow-state-dev/claude-code/sdk` — run a Claude Code agent in-process and watch
it work through your flow's item stream. The agent's messages, reasoning, tool
calls, and sub-agents become flow-state-dev items as they happen, and its session
carries across requests.

It is one of three harnesses flow-state-dev ships. [Coding agents](./coding-agents.md)
covers what they have in common — the handle they all return, and the
configuration contract underneath `cwd`, `resume` and `onSession`. [Codex](./codex.md)
and [Cursor](./cursor.md) are the other two. This page is the Claude Code one.

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
  model: "openai/gpt-6-luna",
  uses: [createClaudeCodeAgentCapability()],
});
```

## As a sequencer step

When the host decides to run the agent (rather than letting a model choose), use
the block directly:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const env = harnessEnv({ pass: ["PATH", "HOME", "CLAUDE_CODE_OAUTH_TOKEN"] });
const agent = claudeCodeAgent({
  env,
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "You are a careful refactoring assistant.",
  },
  allowedTools: ["Read", "Grep", "Edit"],
});
// seq.step(agent) with input { prompt: "Tidy the imports in src/." }
```

The block returns [the neutral harness handle](./coding-agents.md#the-handle) with
`source: "claude-code/sdk"`, plus two fields only Claude Code can fill:
`resultSubtype` (the SDK's terminal result code) and `toolsObserved` (the distinct
tool names the run exercised).

## What it emits

As the agent runs, the block translates the SDK stream into items:

| SDK output | flow-state-dev item |
|------------|---------------------|
| Assistant text | `message` (streamed token by token when partial messages are on) |
| Extended thinking | `reasoning`, when the SDK returns any text. Thinking with the text withheld emits nothing. |
| Tool call and its result | `tool_output`, with the tool call's id, name, and arguments. While it runs, a transient `status` carries the call's `description` for Bash, or `Using <tool>…` for any other tool, and it clears when the last open tool finishes. |
| Sub-agent (`Task`/`Agent`) | a `container` grouping the sub-agent's items. While it works, a transient `status` shows the sub-agent's summary if it has one, otherwise its description followed by the last tool it used, such as `Refactor imports (Edit)`. Status text is cut to 120 characters. A sub-agent with neither a summary nor a description shows no status. |
| Run start | transient `status`: `Starting Claude Code…`, shown from the moment the run starts. |
| API retry | transient `status` each time Claude Code retries a failed API call, for example `Claude Code is retrying a failed API call (attempt 2 of 5, in 5 s)…`. The `, in 5 s` part is left out when the SDK reports no delay. |
| History compaction | transient `status`: `Claude Code agent compacted its context`. Compaction is Claude Code summarizing a long conversation to free up space. |
| Run end | a `status` kept in the session's history, saying how long the run took: `Claude Code agent run completed in 5 mins, 24 seconds.` A run that fails ends with a kept status that says it errored and why, `Claude Code agent run errored (<reason>).`, besides the `error` item. |
| Errors | `error` |

The run-start, API retry, and compaction statuses clear on the first output Claude Code produces after them: an assistant message, a streamed token, a tool result, or the run's result. Nothing else clears them. Another status replaces them straight away, such as a tool's `Using <tool>…`.

The run-end duration is rounded to the nearest second and written with units: `1 min, 1 second`. A run of an hour or more shows hours and minutes only (`1 hr, 3 mins`). Under half a second reads `less than a second`.

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

Background work runs in a *dispatch run*, a session separate from the request
that started it. If you dispatch the agent into one, set `detached: true`:

```ts
const agent = claudeCodeAgent({ detached: true });
```

Each job is then one run. Nothing is written to session state, and no prior SDK
conversation is resumed — a second job landing in the same session begins a
new agent run. What the run did is still recorded: that session's own item stream
holds its messages, reasoning, and tool calls in order, which is what you read the
run back from.

**The session id does not disappear.** The option governs session state and
automatic resume, not the run's own result: the handle the block returns still
carries the SDK `sessionId` it observed. When the agent runs as a task-board
worker, that handle is the worker's output, and the board writes the output onto
the task when it settles — so the id is persisted there. Worth knowing if you are
reasoning about data retention, or if you plan to resume a run by hand later.

You have to pass it there. A worker that runs in a dispatch run may share that
session with other rows, so two blocks declaring the same session-state key would
overwrite each other. The task board refuses to build a dispatch whose block
declares session state.

That refusal reads the worker block, the blocks composed inside it, and the
session state a capability the block `uses` declares for itself. What it cannot
read is a schema a capability's *preset* adds, since a preset's contribution
depends on a runtime opt-out. So pass the option wherever you attach the agent —
the capability form takes the same one:

```ts
createClaudeCodeAgentCapability({ detached: true });
```

See [Dispatched work](../server/background-work.md) for how a dispatch run is
started and read back.

### Continuing a run on the background path

Background jobs start fresh by default. Sometimes you want the next one to pick up
where the last one left off — the job asked a question, a person answered it, and
the follow-up should continue that conversation rather than start over knowing
only what its prompt says.

Two options do that, and they work as a pair. `resume` says which session to
continue; `onSession` tells you which session the run turned out to be in.

```ts
claudeCodeAgent({
  detached: true,
  // Which conversation to continue. Read it from somewhere you control —
  // never from the block's input, which a model can see and set.
  resume: (ctx) => lastSessionFor(ctx),
  // Called during the run, the moment the agent names its session.
  onSession: (id, ctx) => recordSessionFor(ctx, id),
});
```

Return `null` or `""` from `resume` and the run starts fresh, which is what you
want on the first attempt.

`onSession` fires **during** the run rather than after it, and that timing is the
reason it exists rather than reading the id off the returned handle. A run that
gets cancelled — a deadline, a shutdown — never returns a handle at all, and that
is exactly the run you most want to continue. The hook is called as soon as the
agent names its session, before the run does anything that could fail.

What the hook reports is the session the agent **confirmed** it is in, which is not
always the one you asked for. Hand it an id the agent can no longer find and the
run may answer with a session of its own, or end without naming one. So record what
the hook gives you, and treat "the hook never fired" as "there is nothing to
continue" — the next attempt then starts fresh on its own, instead of asking for a
session that is gone over and over.

Both options are background-path only. In session, the block already resumes the
last run and records the new id itself, so a second answer to either question would
be two owners of one decision. Passing them without `detached: true` throws when
you build the block, not at run time.

## Where the run works

By default the agent runs in whatever directory your server process is running
in. That is fine when the run is editing scratch files. It stops being fine the
moment two runs need to work on different copies of something, or a run needs to
work on a checkout that is not the one the server lives in.

`cwd` gives a run its own directory:

```ts
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const CHECKOUT_ROOT = "/var/agent-checkouts";

const agent = claudeCodeAgent({
  cwd: async () => {
    // `mkdtemp` creates the unique leaf, not the parent — it fails ENOENT if
    // the root is not already there, which on a fresh machine it is not.
    await mkdir(CHECKOUT_ROOT, { recursive: true });
    return mkdtemp(join(CHECKOUT_ROOT, "run-"));
  },
  // A fresh directory per run only makes sense with a fresh conversation.
  // See below.
  detached: true,
});
```

It is a function rather than a string on purpose. A flow is built once and then
serves many runs, so a fixed directory would be the wrong shape. This resolves
per run, just before the agent starts, and can return a promise as it does here.
It is handed the block's context and never the prompt, for the reason
[Coding agents](./coding-agents.md#the-prompt-is-the-input-everything-else-is-configuration)
gives.

**A throwaway directory and a resumed conversation do not go together**, which is
why `detached: true` is in the example. By default the agent keeps conversation
state and hands the SDK a `resume` handle from the previous run in the same
session. Pair that with `mkdtemp` and the second invocation resumes a
conversation created in a directory that has nothing to do with the tree it now
runs in — the agent picks up mid-task in an empty checkout. Either start fresh
each run, as here, or keep a stable directory when you want resume.

The run's file tools address relative paths inside the directory. So does the
record of what the run touched, if you have `recordWork` on (below): `src/a.ts`
written by a run in one checkout and `src/a.ts` written by a run in another are
two entries, not one.

A working directory is not a sandbox. The run can still address an absolute path
outside it, and that operation is recorded at the path it actually reached. The
file record is a log of what the run's tools did, not a fence around where they
may go.

### Reusing a directory across runs

The example above throws its directory away. Sometimes you want the opposite —
runs that belong together sharing a checkout, so a second attempt picks up where
the first stopped.

If that work arrives as rows on a task board, you do not have to build this. The
[harness manager](/docs/orchestration/harness-manager) derives a checkout per
task, provisions it, and holds it under a lease for the length of the run. The
rest of this section is the hand-rolled version, for a host driving the agent
itself.

It means building the path out of a value, and it is worth being careful about
which value and how.

```ts
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

function segment(value: string | undefined): string {
  // Absence is `0`; a present value is `1` followed by a SHA-256 digest of its
  // UTF-16 code units. Exactly 65 characters whatever the id's length, which
  // is what keeps a long session id from overflowing the 255-character
  // filename limit.
  //
  // Digest the CODE UNITS, not the UTF-8 bytes. UTF-8 cannot represent a lone
  // surrogate, so hashing `value` directly maps "\ud800", "\ud801" and a
  // literal "�" onto one digest — a collision anyone can produce on purpose.
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

`checkoutFor` derives a path and nothing more — deriving is pure and testable,
provisioning is the resolver's job. Wire both halves of the identity in, and
create the directory before handing it over:

```ts
const agent = claudeCodeAgent({
  cwd: async (ctx) => {
    const dir = checkoutFor(
      ctx.session.identity.tenantId,
      ctx.session.identity.id,
    );
    // The SDK spawns a process into this directory, so it has to exist —
    // Node fails the spawn with ENOENT otherwise. `recursive` is what makes
    // reuse work: the second run finds the first run's tree instead of
    // erroring on a directory that is already there.
    await mkdir(dir, { recursive: true });
    return dir;
  },
});
```

#### Keeping two runs out of one tree

A reused checkout is shared mutable state. Actions run concurrently unless you
say otherwise, and the resolver above creates the directory without claiming it,
so two runs for the same session get the same tree and their edits and Git
operations race in it.

Declare a [concurrency policy](../advanced/concurrency-policies.md) on the action
that runs the agent:

```ts
defineFlow({
  kind: "coding",
  actions: {
    // `queue` serializes on the session — the same value the checkout is
    // derived from, so one run finishes in the tree before the next starts.
    // `reject` instead if a second request should be dropped rather than
    // waited on.
    implement: { block: codingPipeline, concurrency: "queue" },
  },
});
```

The two keys lining up is the point: derive the checkout from the session and
arbitrate on the session.

A policy arbitrates dispatches, which covers one of the three ways two runs can
end up in one checkout, and a second when the workers share a lease backend:

| How | Covered? |
|---|---|
| **Two requests, one session.** | Yes. That is what the policy is for. |
| **Two agent invocations inside one dispatch.** | No. A generator's tool calls in a single model step run concurrently, so a model holding this block as a tool can call it twice and both land in the same directory, inside one dispatch where the policy never sees them. |
| **Two workers, one session.** | Only when the workers share a lease backend. By default the arbiter keeps its keys in the running process, so routing execution to external workers leaves both able to land in one checkout. A queue adapter that supplies a lease backend every worker shares (`WorkerAdapter.leaseBackend`) lines them up on the same session key. |

So the recipe is safe for a single-instance host, or workers that share a lease
backend, running the agent as a step, one invocation per dispatch. Outside that, derive a fresh directory per run — or let
the harness manager hold the lease.

#### Rules for deriving the key

**Encode, don't validate.** A validating grammar has to enumerate every way a
string can misbehave as a path, and that list is longer than it looks: separators
and `..` are the obvious two, but Windows also strips trailing dots (so `acme`
and `acme.` are one directory), reserves `CON`, `PRN`, `AUX`, `NUL`, `COM1`…`LPT9`
as device names that cannot be directories at all, and folds case. Every one of
those is a value two different tenants could hold. A derived segment sidesteps
the list: its output alphabet contains nothing any filesystem treats specially.

**Hash the code units, not the UTF-8 bytes.** A JavaScript string is a sequence
of UTF-16 code units, and not every such sequence is valid Unicode: a *lone
surrogate* like `"\ud800"` is a legal JS string that JSON will carry to your
server. UTF-8 has no representation for one, so anything that transcodes through
it — `Buffer.from(value, "utf8")`, or passing the string straight to
`createHash().update()` — substitutes the replacement character, and `"\ud800"`,
`"\ud801"` and a literal `"�"` all come out identical. Three distinct session
ids, one working tree.

**Bound the output, which is why this is a digest.** Filenames stop at 255
characters, and any encoding that preserves its input grows with it — hex of
UTF-16 code units runs to four characters each, so a 64-character session id
produces a 257-character component and `mkdir` fails with `ENAMETOOLONG`. Ids
that long are ordinary. A digest is a fixed 65 characters for every input. The
trade is real: a reversible encoding gives provable distinctness and stays
readable, a digest rests on SHA-256 and tells you nothing about whose checkout
it is. Distinct ids give distinct directories either way.

**Never truncate.** Cutting a reversible encoding to fit maps two long ids onto
one segment, which is the collision the encoding was there to remove. Bound it by
construction or refuse the value.

**Give each value its own segment.** Concatenating them into one string brings
back the ambiguity the tenant is there to remove.

**Encode whether a value is there, not just what it is.** A missing tenant is
tempting to fill in with `tenantId ?? "default"`, but a stand-in is a value some
tenant may legitimately hold, and then an un-tenanted host and that tenant edit
one tree. The tag does the same job without the collision: absence has its own
encoding no present value can produce. It also keeps every segment non-empty,
which matters because `join` discards an empty one, so a run keyed on an empty id
would land a level up.

**Use `ctx.session.identity.tenantId`** — the authenticated value the server
resolved. It is separate from `ctx.session.identity.id`, which stays the bare
session id the caller passed: two tenants can hold the same one, which is why the
framework namespaces its own session storage by tenant and why a path built from
the session alone puts both tenants in one checkout.

If your key is already something you control and know to be safe — a numeric job
id, a UUID — the encoding is close to a no-op and you can skip it. Encode by
default anyway: the moment the key starts coming from somewhere else, the rules
you would have to remember are a list nobody finishes. And prefer a key your own
code assigned over one that arrived with the request.

## Configuring the run

These options travel with `cwd`. All are unset by default.

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

// One checkout per invocation, shared by both resolvers. They receive the same
// context object, so a WeakMap keyed on it hands them the same directory and
// releases it when the run is done.
const checkouts = new WeakMap<object, Promise<string>>();
const checkoutFor = (ctx: object) => {
  const existing = checkouts.get(ctx);
  if (existing) return existing;
  const fresh = allocateCheckout();
  checkouts.set(ctx, fresh);
  return fresh;
};

claudeCodeAgent({
  cwd: (ctx) => checkoutFor(ctx),
  settingSources: ["user"],
  settings: { disableAllHooks: true },
  env: { ...harnessEnv({ pass: ["PATH", "HOME", "ANTHROPIC_API_KEY"] }), CI: "1" },
  sandbox: async (ctx) => ({
    enabled: true,
    filesystem: { allowWrite: [await checkoutFor(ctx)] },
  }),
  // Tools this process serves to the run, grouped by server: a value, or a resolver per run.
  mcpTools: async (ctx) => ({
    tracker: { tools: await trackerToolsFor(ctx), close: async () => {} },
  }),
  uses: [myCapability],
  onErrored: async (error, ctx) => {
    await releaseWhateverThisRunHeld(ctx);
  },
});
```

**`settingSources`** picks which filesystem settings the run loads: `"user"`,
`"project"`, `"local"`. Leave it out and it loads all three, the way the CLI
does. This is the one to read twice. `"project"` is what makes a run read
`CLAUDE.md` and `.claude/settings.json` **out of its working directory**. If that
directory is one your server assembled out of resources your own users can
write, then those files are user input, and the run reading configuration from
them means your users configure your agent. Pass `[]` to load none, or list only
the sources you control.

**`settings`** is a settings layer of your own for the run, in Claude Code's
`settings.json` shape, forwarded as given. It sits above every source
`settingSources` loads, so a key here wins over the same key in the repository's
`.claude/settings.json`. Leave it out and the run gets none.

The case it's for is a repository you trust. `"project"` loads its `CLAUDE.md`
and skills, which is what you want, and also its hooks: shell commands Claude
Code runs by itself on events like a prompt or a stop. They show in no transcript,
and a run can write one into `.claude/settings.json` for the next run to execute.
To load the conventions and keep every hook off:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { CLAUDE_CODE_PASS, claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

claudeCodeAgent({
  cwd,
  settingSources: ["project"],
  settings: { disableAllHooks: true },
  env: harnessEnv({ pass: CLAUDE_CODE_PASS }),
});
```

With `mcpTools` set, the run's settings also carry
`disableClaudeAiConnectors: true`, whatever yours say, so the handed servers stay
the run's whole MCP set.

**`env`** sets the environment variables the run's process sees. Leave it unset and the run's process
starts with your server's entire `process.env`: every API key, token and
connection string in it, readable by any shell command the model runs. Setting
`env` replaces that environment. It does not add to it.

`harnessEnv` from `@flow-state-dev/core` builds an `env` out of a list of names
and passes only those. Nothing is implicit, so name `PATH` and `HOME` yourself;
the run's shell commands and git are found through `PATH`. A named variable that
isn't set on the server is left out, and one set to an empty string is kept.
Values are read once, when `harnessEnv` is called. Called inline as above, that
is when the block is built, so a variable set after that never reaches the run.

To add a fixed value, spread the allowlist and set it beside it, as the example
does with `CI`. Spreading `process.env` there hands the run every secret the
server holds.

If you'd rather not write the list yourself, the package exports one.
`CLAUDE_CODE_PASS` names what a run needs to work: `PATH`, `HOME`, `USER`,
`SHELL` and `TMPDIR`, the two credential variables (`ANTHROPIC_API_KEY` and
`CLAUDE_CODE_OAUTH_TOKEN`), and the proxy and CA settings a proxied network
needs, in upper and lower case.

Include lowercase proxy names too; curl reads only `http_proxy`.

```ts
import { CLAUDE_CODE_PASS } from "@flow-state-dev/claude-code/sdk";

const env = harnessEnv({ pass: CLAUDE_CODE_PASS });
```

Give that same `env` to
[`probeClaudeAccount`](#checking-for-a-credential-before-you-start),
[`listClaudeModels`](#choosing-the-model) and
[`readClaudeUsage`](#reading-usage-left), so they see the account the run sees. If your runs need
more, add the names to it: `harnessEnv({ pass: [...CLAUDE_CODE_PASS, "GH_TOKEN"] })`. Anything you
pass is readable by every command the run starts, so the model can print it, and it can end up in a
log or a commit.

**`sandbox`** is the Agent SDK's sandbox settings, forwarded as given. Take a
value or write a resolver. The resolver form is the one that matters: the
settings that confine a run name the directory it works in, and that directory
is per run while one flow build serves many. A constant can say "sandboxed"; it
cannot say "sandboxed to this run's workspace."

`filesystem.allowWrite` adds paths to what the run may write. It does not
replace the default set, and it is not a fence on its own — `enabled` is what
turns sandboxing on, and `denyWrite` and the permission rules are what narrow
it.

**`mcpTools`** hands the run tools that run in your own process, presented to it
as MCP servers. Each entry is a server, named by its key, and each tool is a
name, a description, a JSON Schema for its input and a `call` function; the run
calls it as `mcp__<server>__<tool>`. There is no field for an address or
headers, so the run never learns where a tool's work happens or what credential
it uses. Set, even to `{}`, it is the run's complete MCP set: no servers from
settings files, plugins or the account's claude.ai connectors. The tools are
allowed without asking, and `disallowedTools` still keeps one out. Each
server's `close` is called when the run ends, however it ends. A coding run on
a Workforce project gets its project's servers this way; see
[Tools a project's coding work gets](../workforce/projects.md#tools-a-projects-coding-work-gets).

**`uses`** installs capabilities on the agent block, the same slot every other
block takes. A capability handed here that declares resources has them
registered on the flow, so `ctx.resources` resolves for them at run time.
Capabilities resolved dynamically, by a function rather than a static entry,
contribute context, tools and
[`controlTools`](../advanced/capabilities-authoring.md#tools-and-controltools)
only — a resource has to exist before the block runs.

**`onErrored`** runs after the block threw, with the error and the block's
context. It does not swallow the error; the run still fails. A capability can
contribute resources, state and tools but never lifecycle hooks, so this is the
only way to reach one. Releasing something the run was holding is what it is
for.

### The prompt the run starts from

A system prompt is the standing instruction the agent reads before your request. Leave
`systemPrompt` out and the run starts from Claude Code's own, the same one the `claude` command
uses, so a run started this way gets the same standing instructions as the agent you know from
the terminal.

To add your own instructions on top, append them:

```ts
claudeCodeAgent({
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "Commit your work with git before you finish.",
  },
});
```

A plain string replaces Claude Code's prompt entirely. The agent then knows only what your string
says, though it still has its tools. Use a string when you want that narrow agent; use `append`
when you want to add a line.

`""` starts the run with no system prompt at all. The value is forwarded to the Agent SDK as
given, so any shape the SDK accepts works here, and the SDK rejects one it doesn't.

## Recording what the run did

The item stream tells you what the agent said. `recordWork: true` also records
what it did, as ordinary state you can query afterwards.

Entries follow the run's [working directory](#where-the-run-works) when you set
one, so the paths you read back describe the checkout the run was actually
given.

```ts
const agent = claudeCodeAgent({
  detached: true,
  recordWork: true,
});
```

It is off by default. Turned on, the agent declares four **resource
collections** — a resource collection is a keyed set of small state records the
framework stores and serves for you — and writes into them as the run goes:

| Collection | One entry per |
|---|---|
| `observed-file-ops` | path the run's file-writing and file-editing tools touched: how it was touched, when, and whether the attempt applied |
| `observed-plan` | item on the conversation's to-do list: its wording, its current status, the status before that, and the request that last changed it |
| `observed-plan-list` | conversation whose plan could not be written in full, with the reason; and, per run, a pointer to the conversation the run's plan is in |
| `observed-gaps` | thing the recorder understood and could not record, with the reason and which record it stands in for |

File and gap entries are keyed as `<requestId>/<invocation>`. One session can
host several runs over its life, and a single request can itself run the agent
more than once (a generator holding it as a tool can call it repeatedly), so
both halves are needed to keep one run's answer from becoming somebody else's.

Plan entries are keyed by conversation instead, as
`conversation/<session id>/<task id>`, where the session id is the Claude Code
session the run worked in. A later turn's `TaskUpdate` lands on the row its
earlier `TaskCreate` wrote, so the item keeps its title. Each run writes its
pointer in `observed-plan-list`, under `<requestId>/<invocation>`, once Claude
Code names the session.

### Reading it back

Both records come back over the resource route, one page at a time. Scope the
read with `topicPrefix`, and follow `nextCursor` while one is returned:

```
GET /sessions/<sessionId>/resources/observed-file-ops?topicPrefix=observed-file-ops/<requestId>/

{ "items": [
  { "topic": "<requestId>/<invocation>/work/repo/src/checkout.ts",
    "storageKey": "observed-file-ops/<requestId>/<invocation>/work/repo/src/checkout.ts",
    "clientData": { "lastKind": "edited", "outcome": "applied",
                    "lastTouchedAt": 1787021400123, "appliedCount": 2 } }
] }
```

Prefixing with the request id gives you everything that request did; adding the
invocation narrows it to one run.

Each row's payload is on `clientData`. `outcome` has three values, not two:
`pending` while a mutation has been seen and not yet settled, then `applied` or
`failed`. A run that is killed mid-flight leaves its unsettled entries as
`pending`, because nobody confirmed the write.

`appliedCount` sits beside it and counts confirmations, not attempts. Each
operation is recorded twice, once when the call is seen and once when its
result arrives, so a count of everything recorded would report double the work
the run did. `outcome` describes only the last settlement, which is why a
separate count is worth having: it says how many of a path's touches actually
landed. Read `0` and `null` differently. `0` means the run touched the path and
nothing applied. `null` means the row was written before the field existed.

The plan record is read from `observed-plan`. Its shape is the one every harness
shares, and [reading a request's plan](./coding-agents.md#reading-a-requests-plan)
shows how to get from a request id to its conversation's entries. Importing
`observedPlanCollection` from this package or from `@flow-state-dev/core` gives
the same object. A to-do item's status is the harness's own word for it, and
stays empty until the harness reports one. Plan entries reach an open page as
they change, rather than when the request ends.

Claude Code reports its plan item by item, so the conversation's list marker
carries no count and is written only when a plan entry fails to write. It then
reads `incomplete`, and stays that way for the rest of the conversation. A
conversation whose earlier turns were recorded per run starts its plan from its
next write, so a `TaskUpdate` to an item one of those turns created shows as a
row with no title.

The plan record fills only when the agent keeps a to-do list with Claude Code's to-do tools,
`TaskCreate` and `TaskUpdate`. Every run is offered them: on newer models Claude Code switches
them off unless they're named in `allowedTools`, so the block adds them to whatever list you
pass. They ask no permission, so this allows nothing else. To keep a run from them, list them in
`disallowedTools`. A run with `permissionMode: "bypassPermissions"` also gets the search tools
`Grep` and `Glob`. In other modes you name those yourself, because naming them approves searches
outside the working directory without asking. The agent still has to choose to use them, which it often doesn't on a short
job, whatever prompt the run started from. When it doesn't, the record stays empty. That is the honest answer, not a
recording failure, and nothing appears in `observed-gaps` for it.

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

Each gap row carries a `kind` — `file`, `plan`, or `run` — saying which record
it stands in for. Match on that rather than on the wording of `reason`: a gap
for a mutation with nothing to key on has no path to identify it by, and the
reason text is prose meant for a person.

### The plan is not a work queue

A run's to-do list goes into its own record, separate from the task board that
dispatched the run. An agent that decides mid-run to do five more things writes
five to-do items and starts nothing. Picking one up is a separate act.

Attaching the agent as a capability takes the same option, and needs it — the
capability declares the collections itself:

```ts
createClaudeCodeAgentCapability({ detached: true, recordWork: true });
```

See [Resource collections](../resources/collections.md) for how collections are
stored, paged, and made visible to clients.

## Files that outlive the run

A run needs a directory to work in, and that directory is usually temporary. The files it produces usually shouldn't be.

`createWorkspaceAgentCapability` fills the directory from your resource collections before the run and reconciles what changed back afterwards:

```ts
import { createWorkspaceAgentCapability } from "@flow-state-dev/claude-code/sdk";

const workspace = createWorkspaceAgentCapability({
  root: async () => mkdtemp(join("/var/agent-checkouts", "run-")),
});

generator({
  name: "coder",
  model: "openai/gpt-6-luna",
  prompt: "Use the workspace agent to make the change.",
  uses: [workspace],
});
```

Each collection is mounted at its pattern prefix, so one matching `artifacts/**` shows up at `<root>/artifacts/`. `collections` and `exclude` narrow the set.

The capability wraps [`@flow-state-dev/workspace`](./workspace.md), which is where the mounting, the reconcile and the full outcome vocabulary are documented. Reach for the package directly when you want to project files for something other than this agent.

### When two writers touch one file

A run isn't the only thing that can change a collection. Another run, an action block, a person in the UI — any of them can edit a file while a run holds it.

The reconcile checks before it writes: does the collection still hold what this run was given? If it does, the write goes through. If it doesn't, nothing is written and the path is recorded. Deletes go through the same check, so a file the run removed and somebody else edited stays put.

That check catches a writer who already wrote. It can't catch one writing at the same moment, so the run also claims each path it saves, for as long as the save takes. Another run reaching a claimed path stands off instead of overwriting. Claims are per file: two runs sharing a collection while working on different files both save, and neither is refused.

Three outcomes end up in the `workspace-outcomes` collection, keyed by run:

- **conflict** — two writers, one file. Carries three hashes: what the run was given, what the collection holds now, and what the run left. `ours: null` means the run deleted a file somebody else had edited.
- **contested** — another run was writing the file at the same moment, so this one stood off. No hashes, because nothing has been written to disagree about yet. The row names the path so you can stop the two runs sharing it.
- **orphan** — a file written outside every mounted collection, so nothing owns it.

A status item reports how many there were, so a run that ends with unsaved work doesn't end quietly.

### Containment

By default the run is confined to the workspace it was given, through two settings that answer different halves of the same question.

`settingSources: []` stops the run reading its **configuration** out of the workspace. This one is easy to miss. A projected directory holds whatever your collections hold, and in a real application your users write those. A `CLAUDE.md` or a `.claude/settings.json` sitting among them is user input — and an agent reading its instructions out of user input is a different product than the one you shipped.

The sandbox settings stop the run **writing** outside the workspace. A working directory is not a fence: absolute paths still resolve from inside it. The default names the root as the only writable path and refuses commands that ask to run unsandboxed.

A third setting stops the run **leaving** the workspace. The SDK's worktree tools relocate a run mid-flight when the model asks for it, and a projection that filled one directory would then be reconciling a tree the run had already walked away from. Those tools are taken out of the run's reach.

Set `settingSources` or `sandbox` yourself and yours wins. The disallowed tools merge instead, so adding your own doesn't quietly give the relocation ones back. `contain: false` turns all three off, which is what you want when you control everything in the workspace and nothing else.

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

## Choosing the model

`model` takes a Claude model id, or a resolver asked once per run, like `cwd` and
`resume`. A resolver is how one block runs a different model for each session:
read the id from the session's state. A resumed conversation is handed the same
id. Return `null`, or leave `model` unset, and Claude Code runs its own default.

```ts
claudeCodeAgent({
  detached: true,
  resume: (ctx) => previousSessionIdFor(ctx),
  model: (ctx) => (ctx.session.state as { model?: string }).model ?? null,
});
```

To offer a person a choice, `listClaudeModels` asks Claude Code which models it
offers, the same way `probeClaudeAccount` below asks about the credential: no
message, no model turn.

```ts
import { listClaudeModels } from "@flow-state-dev/claude-code/sdk";

const list = await listClaudeModels({ env });
if (list.status === "models") {
  const preselected = list.models.find((m) => m.isDefault) ?? list.models[0];
}
```

Each entry carries the concrete id an alias resolves to: the row Claude Code
calls `sonnet`, or its default, comes back under the model it points at today.
Store that id, and a session keeps its model after the alias moves on. A failed
call resolves to `{ status: "failed", reason }` and never throws.

## Checking for a credential before you start

A run with no credential fails on its first turn, which for a server can be long after it started. `probeClaudeAccount` asks Claude Code up front whether it has something to run on: an API key, or a sign-in under the home folder (the keychain on macOS). It sends no message, so it costs no model turn, and takes about half a second.

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { probeClaudeAccount } from "@flow-state-dev/claude-code/sdk";

const env = harnessEnv({ pass: ["PATH", "HOME", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] });
const account = await probeClaudeAccount({ env });
if (account.status !== "account") throw new Error(`Claude Code can't run: ${account.reason}`);
```

Pass the same `env` you give `claudeCodeAgent`, so the probe sees the credential the run will see and no other. It resolves to one of:

| `status` | When | Also carries |
|----------|------|--------------|
| `"account"` | Claude Code named where its credential comes from | `apiKeySource` and/or `tokenSource`, as the SDK reports them; a subscription sign-in names neither and comes back as `email` and `subscriptionType` |
| `"none"` | No credential, no answer within `timeoutMs` (default 10 000 ms), or Claude Code couldn't be asked | `reason`, a sentence you can show the user, and `unanswered: true` when Claude Code gave no answer |
| `"sdk-missing"` | `@anthropic-ai/claude-agent-sdk` couldn't be loaded | `reason`, with the load error |

It never throws for any of these. It checks where a credential would come from, not that it works: a key that is set but rejected still reads as `"account"`, and fails on the run's first turn.

## Reading usage left

A Claude subscription limits use per time window, such as five hours or a week, and a run fails once a window is used up. Claude Code reports where those limits stand while it runs, so the numbers come from runs. Pass `onUsage` and the block hands you each one:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const env = harnessEnv({ pass: ["PATH", "HOME", "CLAUDE_CODE_OAUTH_TOKEN"] });
const agent = claudeCodeAgent({
  env,
  onUsage: ({ window, observedAt }) => {
    console.log(window.id, window.level, window.usedPercent, window.resetsAt && new Date(window.resetsAt));
  },
});
```

Claude Code sends an update whenever its limits change, and at least once per run on a subscription. Each update becomes one [usage window](./coding-agents.md#subscription-usage), for the limit that binds at that moment:

| Field | Value |
|---|---|
| `id` | Claude Code's name for the window: `five_hour`, `seven_day`, or a weekly variant such as `seven_day_opus` |
| `minutes` | 300 for `five_hour`, 10 080 for the `seven_day` family, `null` for any other id |
| `level` | `"ok"` (under its warning line), `"warning"` (near the limit) or `"reached"` |
| `usedPercent` | 0 to 100, only when Claude Code sends one, which it does near a limit. Otherwise `null`, never 0 |
| `resetsAt` | When the window resets, in epoch ms |

The report around it also carries `harness` (`"claude-code"`, exported as `CLAUDE_CODE_HARNESS`), `observedAt`, `runStartedAt`, and `accountId`, the signed-in email or `null`.

A run on an API key reports nothing. `onUsage` is awaited, but a throw from it doesn't fail the run: a warning is logged and the run carries on. It works on in-session and detached blocks alike.

If you read the SDK stream yourself, `usageWindowOf(info)` maps one raw event payload to a window, or `null`.

To show who is signed in before any run, `readClaudeUsage({ env })` is a [usage reader](./coding-agents.md#subscription-usage). It never throws:

| `status` | When |
|---|---|
| `windows` | Signed in, or running on an OAuth token. Carries `plan` and `accountId`, and **no windows**: those arrive from runs. |
| `api-key` | Claude Code runs on an API key, which has no subscription limit. |
| `signed-out` | Nobody is signed in. |
| `unavailable` | `@anthropic-ai/claude-agent-sdk` isn't installed, or Claude Code couldn't be asked or didn't answer within `timeoutMs` (10 seconds by default) or before `signal` aborted. |

Pass the same `env` as your runs. To keep run windows and readings together and serve them to a page or a worker, register `readClaudeUsage` as the `claude-code` reader of the [harness manager's usage query](/docs/orchestration/harness-manager#subscription-usage) and pass `onUsage` through from the manager's harness slot.

The numbers come only from Claude Code's run events and its account answer. Neither `onUsage` nor `readClaudeUsage` reads a credentials file or calls a usage endpoint.

## Error handling

| Situation | Behavior |
|-----------|----------|
| `@anthropic-ai/claude-agent-sdk` not installed | Throws `ClaudeAgentSdkNotInstalledError` with an install hint. |
| The agent finishes with an error result (hit max turns, budget, or a runtime error) | Treated as an outcome: the handle's `status` is `"errored"`, its `outcome` is `stopped-at-limit` or `failed` (with the SDK's own `resultSubtype` alongside), and an `error` item is emitted. No throw. |
| The turn ends on an API error (the SDK reports a `success` result with `is_error` set) | Treated as a failure, not a success: `status` is `"errored"`, `outcome` is `failed`, `resultSubtype` stays `"success"`, and an `error` item carries the SDK's error text with code `is_error`. No throw. |
| The SDK throws mid-stream | Wrapped in `ClaudeAgentRunError` and rethrown after an `error` item. |
| The block's signal fires (a deadline, a cancel) | The agent is told to stop. The block waits up to 5 seconds for its process to exit, so the session's transcript is complete before anything resumes it, then rethrows the signal's reason after an `error` item. |
| A tool or sub-agent is still open when the stream ends | Its item is marked `incomplete`. |
| Empty prompt | Validation error before the agent starts. |

## Limitations

This version runs the agent and observes it. It does not let flow-state-dev drive
the SDK loop one step at a time, register flow-state-dev blocks as tools the agent
can call, or map sub-agents to nested flow-state-dev generators. Tool approval
degrades to the SDK's own mechanism until native human-in-the-loop lands. Prompts
are strings, not streamed input.

## Related

- [Coding agents](./coding-agents.md) — the harness contract, and the handle this block returns
- [Codex SDK agent](./codex.md) — another harness, same handle
- [Cursor SDK agent](./cursor.md) — another harness, same handle
- [Harness manager](/docs/orchestration/harness-manager) — driving this block from a task board
- [Workspace projection](./workspace.md) — the package underneath the workspace capability
- [Tools overview](./overview.md)
