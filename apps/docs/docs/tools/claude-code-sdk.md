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

Background work runs in a child session, outside the request that started it. If
you dispatch the agent into one, set `detached: true`:

```ts
const agent = claudeCodeAgent({ detached: true });
```

Each job is then one run. Nothing is written to session state, and no prior SDK
conversation is resumed — a second job landing in the same child session begins a
new agent run. What the run did is still recorded: that session's own item stream
holds its messages, reasoning, and tool calls in order, which is what you read the
run back from.

**The session id does not disappear.** The option governs session state and
automatic resume, not the run's own result: the handle the block returns still
carries the SDK `sessionId` it observed. When the agent runs as a task-board
worker, that handle is the worker's output, and the board writes the output onto
the task when it settles — so the id is persisted there. Worth knowing if you are
reasoning about data retention, or if you plan to resume a run by hand later.

The option is also required rather than optional there. A worker that runs in a
child session may share that session with other rows, so two blocks declaring the
same session-state key would overwrite each other. The task board refuses to
build a hand-off whose block declares session state.

That refusal reads the worker block, the blocks composed inside it, and the
session state a capability the block `uses` declares for itself. What it cannot
read is a schema a capability's *preset* adds, since a preset's contribution
depends on a runtime opt-out. So pass the option wherever you attach the agent —
the capability form takes the same one:

```ts
createClaudeCodeAgentCapability({ detached: true });
```

See [Dispatched work](../server/background-work.md) for how the child session is
started and read back.

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
serves many runs, so a fixed directory would be the wrong shape — this resolves
per run, just before the agent starts, and can return a promise as it does here.

**A throwaway directory and a resumed conversation do not go together**, which
is why `detached: true` is part of this example rather than an aside. By
default the agent keeps conversation state and hands the SDK a `resume` handle
from the previous run in the same session. Pair that with `mkdtemp` and the
second invocation resumes a conversation that was created in a directory that
no longer has anything to do with the tree it now runs in — the agent picks up
mid-task in an empty checkout. Either start fresh each run, as here, or keep a
stable directory when you want resume. A per-run directory with resume left on
is the combination that surprises people.

Two things follow the directory. The run's file tools address relative paths
inside it. And the record of what the run touched, if you have `recordWork` on
(below), is keyed there as well — so `src/a.ts` written by a run in one checkout
and `src/a.ts` written by a run in another are two entries, not one.

A working directory is not a sandbox. The run can still address an absolute path
outside it, and that operation is recorded at the path it actually reached. The
file record is a log of what the run's tools did, not a fence around where they
may go.

### Reusing a directory across runs

The example above throws its directory away. Sometimes you want the opposite —
runs that belong together sharing a checkout, so a second attempt picks up where
the first stopped. That means building the path out of a value, and it is worth
being careful about which value and how.

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
  cwd: async (_input, ctx) => {
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

A reused checkout is shared mutable state, so the last thing to wire up is what
happens when two runs for the same session overlap. Actions run concurrently
unless you say otherwise, and the resolver above creates the directory without
claiming it — so both runs get the same tree and their edits and Git operations
race in it.

Declare a [concurrency policy](../advanced/concurrency-policies.md) on the
action that runs the agent:

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

**A policy arbitrates dispatches, so be precise about what that does and does not
cover.** Three ways two runs can end up in one checkout, and this closes one of
them:

- **Two requests, one session.** Covered. That is what the policy is for.
- **Two agent invocations inside one dispatch.** Not covered. A generator's tool
  calls in a single model step run concurrently, so if you expose this block as
  a model-facing tool through the agent capability, the model can call it twice
  in one step and both invocations land in the same directory — inside one
  dispatch, where the policy never sees them. Give the agent a per-run directory
  (the `mkdtemp` example above) when the model can invoke it, and keep the
  reused checkout for one agent step per run.
- **Two workers, one session.** Not covered. The arbiter is a map in the running
  process, so routing execution to external workers leaves both able to land in
  one checkout. That needs a lock in shared storage, which is beyond what this
  recipe gives you.

So the recipe is safe for a single-instance host running the agent as a step,
one invocation per dispatch. Outside that, derive a fresh directory per run.

Encoding rather than validating is the whole point, and it is worth being
explicit about why. A validating grammar has to enumerate every way a string can
misbehave as a path, and that list is longer than it looks: separators and `..`
are the obvious two, but Windows also strips trailing dots (so `acme` and `acme.`
are one directory), reserves `CON`, `PRN`, `AUX`, `NUL`, `COM1`…`LPT9` as device
names that cannot be directories at all, and folds case. Every one of those is a
value two different tenants could hold.

A derived segment sidesteps the whole list: its output alphabet contains
nothing any filesystem treats specially, and two distinct ids do not share a
directory.

**Hash the code units, not the UTF-8 bytes.** A JavaScript string is a sequence
of UTF-16 code units, and not every such sequence is valid Unicode: a *lone
surrogate* like `"\ud800"` is a perfectly legal JS string that JSON will carry
to your server. UTF-8 has no representation for one, so anything that transcodes
through it — `Buffer.from(value, "utf8")`, or passing the string straight to
`createHash().update()` — substitutes the replacement character, and `"\ud800"`,
`"\ud801"` and a literal `"�"` all come out identical. Three distinct session
ids, one working tree. Hashing the code units has no such gap, because it
consumes what the string actually is rather than a translation of it.

**And the output has to be bounded, which is why this is a digest rather than a
reversible encoding.** Filenames stop at 255 characters. Any encoding that
preserves its input grows with it — hex of UTF-16 code units runs to four
characters each, so a 64-character session id produced a 257-character
component and `mkdir` failed with `ENAMETOOLONG`. Ids that long are ordinary,
and no retry can shorten one. A digest is a fixed 65 characters for every
input.

That trade is worth stating plainly, because it is a real one:

| | Reversible encoding | Digest |
|---|---|---|
| Distinctness | provable | collision-resistant |
| Length | grows with the id | fixed |
| Readable | yes — you can decode it | no |

Distinct ids give distinct directories in both cases; the digest rests on
SHA-256 rather than on arithmetic. That is not a failure mode this system will
meet, and it buys the bound. What it costs is legibility — the path no longer
tells you whose checkout it is.

**The one thing not to do is truncate.** Cutting a reversible encoding to fit
would map two long ids onto one segment, which is the collision this example
spent three rounds eliminating — reintroduced to fix a length. Bound it by
construction or refuse the value; never by trimming.

Give each value its own segment; concatenating them into one string brings back
the ambiguity the tenant is there to remove.

**Encode whether a value is there, not just what it is.** A missing tenant is
tempting to fill in with a stand-in — `tenantId ?? "default"` — but a stand-in
is a value some tenant may legitimately hold, and then an un-tenanted host and
that tenant address one directory and edit each other's tree. The tag does the
same job without the collision: absence has its own encoding no present value
can produce. The same tag keeps every segment non-empty, which matters because
`join` discards an empty one, so a run keyed on an empty id would quietly land
a level up.

The tenant to use is `ctx.session.identity.tenantId` — the authenticated value
the server resolved. It is deliberately separate from
`ctx.session.identity.id`, which stays the bare session id the caller passed:
two tenants can hold the same one, which is why the framework namespaces its
own session storage by tenant and why a path built from the session alone puts
both tenants in one checkout.

If your key is already something you control and know to be safe — a numeric job
id, a UUID — the encoding is close to a no-op and you can skip it. Encode by
default anyway: the moment the key starts coming from somewhere else, the rules
you would have to remember are a list nobody finishes.

Prefer a key your own code assigned over one that arrived with the request.

## Configuring the run

Four options travel with `cwd`. All are unset by default, so a run that ignores
them behaves exactly as it did before you knew they existed.

```ts
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
  cwd: (_input, ctx) => checkoutFor(ctx),
  settingSources: ["user"],
  env: { ...process.env, CI: "1" },
  sandbox: async (_input, ctx) => ({
    enabled: true,
    filesystem: { allowWrite: [await checkoutFor(ctx)] },
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

**`env`** sets the run's environment variables. It replaces the process
environment rather than adding to it, so spread `process.env` when you meant to
add.

**`sandbox`** is the Agent SDK's sandbox settings, forwarded as given. Take a
value or write a resolver. The resolver form is the one that matters: the
settings that confine a run name the directory it works in, and that directory
is per run while one flow build serves many. A constant can say "sandboxed"; it
cannot say "sandboxed to this run's workspace."

`filesystem.allowWrite` adds paths to what the run may write. It does not
replace the default set, and it is not a fence on its own — `enabled` is what
turns sandboxing on, and `denyWrite` and the permission rules are what narrow
it.

**`uses`** installs capabilities on the agent block, the same slot every other
block takes. A capability handed here that declares resources has them
registered on the flow, so `ctx.resources` resolves for them at run time.
Capabilities resolved dynamically, by a function rather than a static entry,
contribute context and tools only — a resource has to exist before the block
runs.

**`onErrored`** runs after the block threw, with the error and the block's
context. It does not swallow the error; the run still fails. A capability can
contribute resources, state and tools but never lifecycle hooks, so this is the
only way to reach one. Releasing something the run was holding is what it is
for.

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

It is off by default. Turned on, the agent declares three **resource
collections** — a resource collection is a keyed set of small state records the
framework stores and serves for you — and writes into them as the run goes:

| Collection | One entry per |
|---|---|
| `observed-file-ops` | path the run's file-writing and file-editing tools touched: how it was touched, when, and whether the attempt applied |
| `observed-plan` | item on the run's own to-do list: its wording, its current status, and the status before that |
| `observed-gaps` | thing the recorder understood and could not record, with the reason and which record it stands in for |

Entries are keyed as `<requestId>/<invocation>`. One session can host several
runs over its life, and a single request can itself run the agent more than once
— a generator holding it as a tool can call it repeatedly — so both halves are
needed to keep one run's answer from becoming somebody else's.

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
`pending`, which is the honest answer about a write nobody confirmed.

`appliedCount` sits beside it and counts confirmations, not attempts. Each
operation is recorded twice, once when the call is seen and once when its
result arrives, so a count of everything recorded would report double the work
the run did. `outcome` describes only the last settlement, which is why a
separate count is worth having: it says how many of a path's touches actually
landed. Read `0` and `null` differently. `0` means the run touched the path and
nothing applied. `null` means the row was written before the field existed.

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

Each gap row carries a `kind` — `file`, `plan`, or `run` — saying which record
it stands in for. Match on that rather than on the wording of `reason`: a gap
for a mutation with nothing to key on has no path to identify it by, and the
reason text is prose meant for a person.

### The plan is not a work queue

A run's to-do list goes into its own record, deliberately separate from the task
board that dispatched the run. An agent that decides mid-run to do five more
things writes five to-do items and starts nothing. Picking one up is a separate,
deliberate act.

Attaching the agent as a capability takes the same option, and needs it — the
capability declares the collections itself:

```ts
createClaudeCodeAgentCapability({ detached: true, recordWork: true });
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
  model: "openai/gpt-5.4-mini",
  prompt: "Use the workspace agent to make the change.",
  uses: [workspace],
});
```

Each collection is mounted at its pattern prefix, so one matching `artifacts/**` shows up at `<root>/artifacts/`. `collections` and `exclude` narrow the set.

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

