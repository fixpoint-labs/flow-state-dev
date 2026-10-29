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

Each entry is one to-do item: its wording (`title`), the status the harness last
confirmed (`status`), the one before (`previousStatus`), how the last attempt to
change it settled (`lastOutcome`), and the request that last wrote it
(`requestId`), which tells you which turn changed it. Every field can be `null`.
A status is the harness's own word for it, so read it as text rather than
matching a fixed list.

A plan belongs to the harness conversation, not to one run. Its entries are
keyed `conversation/<id>/<item>`, where the id is the one the harness gave the
conversation: Claude Code's session id, Cursor's agent id. Every turn of that
conversation updates the same plan, so a turn that doesn't touch its to-do list
leaves the plan as it was, and a new conversation starts with none.
`harnessConversationNamespace(conversationId)` returns that namespace
(`conversation/<escaped id>`), and `planConversationPrefix(conversationId)` the
key prefix its entries are under.

Entries stream to an open page as they change, so a plan you show beside a
session stays in step while the run works.

A run's plan is a record of what the agent planned, not a work queue. Nothing in
it starts work, and writing to it hands the agent nothing.

Not every harness reports a plan. Read the session's resource manifest first. If
it doesn't list `observed-plan`, the harness records none, and a reader should say
so rather than show an empty list.

A Codex block is one: Codex doesn't keep a to-do list in the version
`@flow-state-dev/codex` supports, so its manifest doesn't list `observed-plan`.

### List markers and pointers

Beside the entries, `observed-plan-list` holds two kinds of marker:

- **The conversation's list marker**, keyed by its namespace
  (`conversation/<id>`). It says whether the plan is `complete`, still
  `writing`, or `incomplete`, how many places it holds, and why it's incomplete.
- **A run's pointer**, keyed by the run's own namespace
  (`<requestId>/<run>`, which `harnessRunNamespace(ctx)` returns). Its
  `conversation` field names the conversation namespace the run wrote its plan
  to. A pointer has no status or count, so don't read it as a list marker.

Read the list marker before the entries:

- `complete` with no places means the agent reported an empty list.
- `incomplete`, or `writing` once the run has ended, means a write failed
  partway. Show what's there as possibly incomplete, with the reason, not as the
  plan.
- With a count, show only the places below it.
- No marker and no entries means the conversation has no plan.

### Reading a request's plan

When you know the request but not the conversation, start from its pointer.
List the request's markers with `planRowsPrefix(requestId, OBSERVED_PLAN_LIST)`
as the `topicPrefix`, and hand them to `readPlanTarget`:

```ts
import { OBSERVED_PLAN_LIST, planRowsPrefix, readPlanTarget } from "@flow-state-dev/core";

// `items` is the page a resource read returned for
// observed-plan-list?topicPrefix=<planRowsPrefix(requestId, OBSERVED_PLAN_LIST)>
const target = readPlanTarget(
  requestId,
  items.map((item) => ({ topic: item.topic, conversation: item.clientData?.conversation ?? null })),
);
```

`target` is one of two shapes:

- `{ kind: "conversation", namespace, rowsPrefix }`: a run of the request left a
  pointer. Read the entries under `rowsPrefix`, and the plan's list marker from
  `observed-plan-list`, keeping the one whose topic equals `namespace`. If a
  retried block left more than one pointer, the last run's wins.
- `{ kind: "run", rowsPrefix }`: no run left a pointer. The request's plan is
  stored per run, under `<requestId>/<run>/<item>`, as in any record with no
  pointer. Read the entries under `rowsPrefix`. None of the markers you just
  listed is a pointer, so use them as the list markers as they are.

### Recording a plan from your own harness

Declare `observedPlanCollection` and `observedPlanListCollection` on the block,
and key the plan under `harnessConversationNamespace(id)` with the id your agent
gives the conversation. Once the id is known, write the run's pointer:
upsert `{ conversation: namespace }` under `harnessRunNamespace(ctx)` in the
marker collection, so a reader that knows only the request finds the plan.

If your agent reports its whole list each time, with no ids, hand it to
`replacePlanList(plan, marker, namespace, items, { requestId })`: it keys
entries by place, stamps `requestId` on each one, keeps an entry's earlier
status when its wording is unchanged, removes entries past the end, and writes
the conversation's list marker. It never throws; a list it can't store in full
leaves the marker `incomplete` and the run carries on. Call it from one writer
per namespace at a time. If your agent reports items by id, upsert entries under
`<namespace>/<item id>` with `requestId` set, and mark the conversation
`incomplete` when a write fails.

## Pull requests a session opened

A coding run often ends by opening a pull request, and a session can open
several. Each one is kept as a row in the session's `observed-pull-requests`
collection, so a page beside the session can list them with their links. The
collection and its row shape live in `@flow-state-dev/core`:

```ts
import {
  OBSERVED_PULL_REQUESTS, // "observed-pull-requests"
  observedPullRequestsCollection,
  observedPullRequestStateSchema,
  type ObservedPullRequestState,
} from "@flow-state-dev/core";
```

A row has these fields, and every one can be `null`:

| Field | What it holds |
|---|---|
| `host` | The forge's host, lower-cased: `github.com`, or a GitHub Enterprise host. |
| `repository` | `owner/name`. |
| `number` | The pull request's number. |
| `url` | Its web link. |
| `title` | Its title, when the call that opened it set one. |
| `state` | `open`, `closed`, `merged` or `draft`, as seen when the row was written. It isn't kept current afterwards. |
| `branch` | The branch it merges from, when known. |
| `requestId` | The request that opened it. |
| `source` | `tool` when a create call named it, `branch` when the [branch check](#the-branch-check) found it. |
| `firstSeenAt` | When it was first recorded, in epoch ms. |

Rows are keyed by host, owner, repository and number (`pullRequestKey(ref)`
builds the key), so a pull request seen twice in a session is one row. A row is
written as soon as the tool call that opened it finishes, and the collection is
live, so an open page shows it while the turn is still running.

### What counts as opened

A row comes from a tool call that creates a pull request and whose **output**
names it with a `https://<host>/<owner>/<repo>/pull/<n>` link. With the GitHub
rule that ships, a create call is one of these:

- A shell call whose command runs `gh pr create` or `gh pr new`.
- A tool named `create_pull_request`, under any MCP server prefix
  (`mcp__github__create_pull_request` counts).

These are not create calls, even when their output holds a link: `gh pr view`,
`gh pr list`, a search, or any other tool. A link that appears only in a call's
arguments doesn't count either, and neither does the
`https://github.com/<owner>/<repo>/pull/new/<branch>` link `git push` prints.
A `gh pr create` that fails because the branch already has a pull request,
and prints that pull request's link, does count.

Which links in the output count depends on the call:

- **`create_pull_request`** opens one pull request. The recorder reads it from
  the result's `html_url` (or `url`) field. The result also holds the new pull
  request's body, and a link in that body is not recorded. A result with no
  such field, such as a plain-text error, gives its first link.
- **A shell command** records every link it prints when `gh pr create` is its
  only `gh` command that prints pull-request links. A loop of creates records
  each one.
- **A shell command that also runs** `gh pr view`, `gh pr list`, `gh api`,
  `gh search` or another `gh pr` command records nothing. Its output can't be
  split by command, so the recorder doesn't guess. Text inside the create's
  `--title` or `--body` is not a command. Ask the agent to run the create on
  its own, or run the [branch check](#the-branch-check) after the turn to
  catch a pull request missed this way.

The title and branch come from the create call when it set them: `--title`/`-t`
and `--head`/`-H` on the command line, or the `title` and `head` arguments of
`create_pull_request`. `state` is `open`.

`findOpenedPullRequests(item, rules?)` runs the same check on one stream item
and returns the `PullRequestRef[]` it finds, if you want to test a call
yourself.

### Reading it

Read the collection like any other client-readable collection. In React:

```tsx
import { useResourceCollectionList, useSession } from "@flow-state-dev/react";
import type { ClientDataOf } from "@flow-state-dev/core";
import { observedPullRequestsCollection } from "@flow-state-dev/core";

function PullRequests({ sessionId, requestId }: { sessionId: string; requestId?: string }) {
  const session = useSession(sessionId);
  const { items } = useResourceCollectionList<ClientDataOf<typeof observedPullRequestsCollection>>(
    session,
    "observed-pull-requests",
    { limit: 50 },
  );
  const rows = items
    .map((item) => item.clientData)
    .filter((row) => requestId === undefined || row.requestId === requestId);

  return (
    <ul>
      {rows.map((row) => (
        <li key={row.url}>
          <a href={row.url ?? undefined}>{row.repository}#{row.number}</a> {row.title} ({row.state})
        </li>
      ))}
    </ul>
  );
}
```

A session's rows span every run in it. To show one run's pull requests, keep
the rows whose `requestId` is that run's request.

The record is a list of what the session opened. Nothing in it starts work,
and a client can't write to it.

### Turning it on

The [Claude Code](./claude-code-sdk.md), [Codex](./codex.md) and
[Cursor](./cursor.md) blocks record pull requests by default. Pass
`recordPullRequests: false` to turn it off; the block then records nothing and
doesn't declare the collection.

```ts
const agent = codexAgent({ cwd, recordPullRequests: false });
```

A flow with no harness, such as a generator holding a shell tool or GitHub's
MCP tools, records by adding `pullRequestRecorder()` as a `.tap` step. The
generator stays as it is:

```ts
import { pullRequestRecorder, sequencer } from "@flow-state-dev/core";

const turn = sequencer({ name: "turn" })
  .tap(pullRequestRecorder())
  .step(assistant);
```

The recorder block declares the collection, reads the tool calls the request
has made so far, and keeps listening for the rest until the request ends. It
finishes its writes before it stops. Placement decides when rows appear:
tapped before the generator, each row lands as its call finishes; tapped after,
the rows land when the recorder step runs.

A request has one recorder. A second recorder block, or a harness block in the
same request, joins the first rather than starting another.
`recordPullRequests(ctx, { rules? })` starts the same recorder from inside your
own block.

Recording never fails a run. If the flow doesn't declare the collection, or the
block's context has no item stream to read, nothing is recorded and a status
note says why. A write that fails is a status note too.

The recorder reads tool calls only. A background worker, or a flow that makes
no tool calls, records nothing, and the recorder never asks GitHub anything.

### The branch check

A pull request opened some other way, through a raw API call or a tool the
rules don't know, never shows up as a create call. The branch check catches
it: after a turn, it asks GitHub which pull requests the checkout's branch has
and writes any it finds with `source: "branch"`. Nothing runs it on its own;
your server code calls it from a block that runs after the turn. Kitchen Sink's
coding modes run it when a turn finishes, and the
[harness manager](/docs/orchestration/harness-manager) runs it before its
verdict and when a run fails. Both count only pull requests created since the
turn or run began, so an older one on a branch the agent switched to is not
claimed. To run it yourself, see
[`recordBranchPullRequests`](./workspace.md#pull-requests-on-a-branch).

A pull request found by both lands on one row. Whichever writes second fills
only the fields that are still `null`, and never changes `requestId` or
`firstSeenAt`. A row the branch check found first changes to `source: "tool"`
once a create call names it. `writePullRequests(collection, refs, { source,
requestId?, now? })` is that write, if you're adding rows from your own code.

### Adding a rule for another forge

GitHub is the only forge recognised out of the box. A rule for another is an
object with a `name` and a `match(call)` that returns the pull requests one
finished tool call opened, or `[]`. `call` carries the tool's `name`, its
`arguments` (an object or a JSON string), and its `output` in whatever shape the
tool returned.

```ts
import {
  DEFAULT_PULL_REQUEST_RULES,
  pullRequestRecorder,
  type PullRequestRef,
  type PullRequestRule,
} from "@flow-state-dev/core";

const MERGE_REQUEST = /https:\/\/(gitlab\.com)\/([\w.-]+)\/([\w.-]+)\/-\/merge_requests\/(\d+)/g;

const gitlabRule: PullRequestRule = {
  name: "gitlab",
  match(call) {
    const command = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? "");
    if (!/\bglab\s+mr\s+create\b/.test(command)) return [];
    const output = typeof call.output === "string" ? call.output : JSON.stringify(call.output ?? "");
    const refs: PullRequestRef[] = [];
    for (const [url, host, owner, name, number] of output.matchAll(MERGE_REQUEST)) {
      if (host && owner && name && number) refs.push({ host, owner, name, number: Number(number), url, state: "open" });
    }
    return refs;
  },
};

const recorder = pullRequestRecorder({ rules: [...DEFAULT_PULL_REQUEST_RULES, gitlabRule] });
```

Only the request's first recorder's rules apply, so in a flow with a harness
block, tap the recorder with your rules before the harness step.

## Subscription usage

A coding agent on a subscription plan has limits per time window, and a run
fails once a window runs out. A *usage reader* asks the agent how much of each
window is used, without a run. The shapes live in `@flow-state-dev/core`, so a
page or a worker reads every agent's usage the same way:

```ts
import type {
  HarnessUsageHook,
  HarnessUsageLevel,
  HarnessUsageReader,
  HarnessUsageReading,
  HarnessUsageReport,
  HarnessUsageWindow,
} from "@flow-state-dev/core/types";
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
limit, its length in `minutes`, `usedPercent` from 0 to 100, `level`, and
`resetsAt` in epoch ms. `label`, `minutes` and `resetsAt` are `null` when the
vendor didn't say. `level` (`HarnessUsageLevel`) is how close the window is to
its limit, when the vendor says: `"ok"` (under its warning line), `"warning"`
(near the limit) or `"reached"`, and `null` for a vendor that sends only a
percent, as Codex does. `usedPercent` is `null` when the vendor sent no
percent; show the `level` instead. `harnessUsageWindowSchema` reads a window
stored with no `level` as `level: null`. The numbers are the vendor's own: a
fraction is scaled to a percent and nothing else is derived. Only `windows`
carries a number: show the `reason` for the other three, never 0%.

A reader returns those states rather than throwing. Codex ships one,
[`readCodexUsage`](./codex.md#reading-usage-left), and Claude Code ships
[`readClaudeUsage`](./claude-code-sdk.md#reading-usage-left).

Some agents report usage only while they run. A harness block that does takes an
`onUsage` hook, a `HarnessUsageHook`: `(report, ctx) => void | Promise<void>`.
Each `HarnessUsageReport` carries one window, plus `harness` (the name a usage
record is kept under), `observedAt` and `runStartedAt` in epoch ms, and the
`accountId` the run is signed in as, or `null`. A run reports the window that
applies to the whole account, not its own share. Claude Code is the agent that
reports this way: its reader names the account and plan, and its windows come
from [`onUsage`](./claude-code-sdk.md#reading-usage-left).

To keep readings and run windows and serve them with their age, hand your readers
to the [harness manager's usage query](/docs/orchestration/harness-manager#subscription-usage)
and let the manager feed your harness its `onUsage`.

## What a run spent

When a run ends, however it ends, the harness block reports what it spent to the request it ran in: one `HarnessRunSpend` per run.

| Field | What it holds |
|---|---|
| `harness` | `claude-code`, `codex` or `cursor`. |
| `inputTokens` / `outputTokens` | The tokens the agent reported, or `null` when it reported none, as for a run killed before its usage arrived. |
| `costUsd` | The cost the agent reported, in US dollars, or `null`. Never an estimate. |
| `billing` | `"api-key"`, `"subscription"`, or `null` when the harness can't tell. |

What each harness fills in:

| Harness | Tokens | `costUsd` | `billing` |
|---|---|---|---|
| Claude Code | From its result | The cost Claude Code reported | From Claude Code's own account info: `api-key` when it runs on a key, `subscription` when it is signed in to a plan, otherwise `null` |
| Codex | From its turns | Always `null` | `api-key` when you hand its client an `apiKey`, otherwise `null` |
| Cursor | Added up turn by turn, so a stopped run keeps the turns it finished | Always `null` | Always `null` |

A failed run reports the tokens it got before it failed. A run that failed before any usage arrived reports `null` tokens.

The report is a count kept apart from the request's model tokens: it never adds to `ctx.request.tokenUsage` or an action's [token budget](/docs/configuration/flow#token-budgets). Workforce records it per worker; see [Worker usage](/docs/workforce/worker-usage).

### Reporting from a harness of your own

Call `reportHarnessSpend` once per run, from a `finally`, with whatever the agent had sent by then:

```ts
import { reportHarnessSpend } from "@flow-state-dev/core/types";

let usage: { input: number; output: number } | null = null;
try {
  // ... run the agent, setting `usage` when it reports tokens
} finally {
  reportHarnessSpend(ctx, {
    harness: "my-agent",
    inputTokens: usage?.input ?? null,
    outputTokens: usage?.output ?? null,
    costUsd: null,
    billing: null,
  });
}
```

It returns `false`, and counts nothing, when the context belongs to no request, such as a hand-built test context.

## What a run is doing

A harness block can report what its run is doing as it goes, through an
`onActivity` hook, a `HarnessActivityHook`: `(activity, ctx) => void`. Each
`HarnessActivity` is one of two kinds:

```ts
type HarnessActivity =
  | { kind: "message"; text: string }                   // a completed assistant message
  | { kind: "tool"; name: string; arguments: string };  // a tool call the run started
```

`arguments` is the JSON text of the call's arguments. Reasoning, streamed
deltas and tool results are never reported. The hook isn't awaited, and a throw
from it is logged while the run carries on. Claude Code and Codex report
messages and tool calls. Cursor reports tool calls only, because it streams
assistant text in pieces.

```ts
const agent = codexAgent({
  cwd,
  onActivity: (activity) => {
    if (activity.kind === "tool") console.log(`tool: ${activity.name}`);
  },
});
```

If you write a harness of your own, `reportHarnessActivity(onActivity, event, ctx)`
from `@flow-state-dev/core` takes one of your translated events and calls the
hook when it counts as activity: a `message` or `message_complete` event becomes
a message, a `tool_call` event becomes a tool call, and anything else is
skipped. It never throws. `harnessActivityOf(event)` is the mapping on its own,
returning the activity or `null`. The
[harness manager](/docs/orchestration/harness-manager#how-a-running-task-is-doing)
uses the hook to keep a running task's status note current.

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

## Steering a running turn

A person who types while a coding turn runs usually means it for that turn. A
harness whose run can take a line mid-turn offers one through its
`onSteerable` hook (Cursor does today; Claude Code and Codex don't yet), and
two helpers turn that into the same behaviour in any app.

On the server, `harnessSteering()` from `@flow-state-dev/core` keeps each
session's offer. Hand its `onSteerable` to the harness and declare its action
beside your turn action:

```ts
const steering = harnessSteering();
const agent = cursorAgent({ cwd, resume, onSession, onSteerable: steering.onSteerable });

defineFlow({
  kind: "coder",
  actions: {
    turn: { block: turn, concurrency: "defer" },
    steer: steering.action(),
  },
});
```

Declare the turn `defer`, so a turn sent while one runs waits for it however
long it takes. A `queue` turn gives up after 30 seconds, and a line sent during
a longer turn would never run. With the default in-memory concurrency backend,
waiting turns start in the order they were sent. With a lease backend shared
across processes, two turns that wait at the same time can start in either
order.

`steer` answers `{ taken, live }`. On the page, `sendHarnessLine` from
`@flow-state-dev/client` sends a line typed while a turn runs to `steer` first,
and sends it as the next turn when the running turn didn't take it, so a line is
never dropped. `harnessLines` keeps a page's lines in the order they were typed, so a later line never steers past one queued behind the turn. `steerRunningTurn` sends `steer` on its own, so a session hook
keeps following the running turn's stream. In React, `useHarnessLines(session)`
from `@flow-state-dev/react` puts these together: it sends a line's next turn
through the client too, and follows it once the running turn ends, so the page
stays on the running turn until then. Offers live in the server process:
a line that reaches another process finds none and runs as the next turn.

Work on a task board steers through the board instead: the harness manager
hands a task's new messages to its running step. See
[Steering a run](/docs/orchestration/harness-manager#steering-a-run).

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
