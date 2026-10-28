---
sidebar_label: Harness manager
---

# Harness manager

A [harness](/docs/tools/coding-agents) is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing what it did. `@flow-state-dev/harness-manager` is a task-board worker that turns a row on a board into a supervised run of one.

A supervised run gets **its own checkout**, not whatever directory your server happens to sit in. **A verdict is read before the row settles**, so a run that produced nothing never closes as done. The run can **ask a question**: its task waits in the user's Inbox until they answer, and the answer continues the same conversation. And **you choose the harness**. The manager imports no harness itself.

```bash
pnpm add @flow-state-dev/harness-manager
```

## What it does

The manager takes each row it claims through these steps, and the row settles at the end:

```
open the run row  →  build the prompt, take the checkout  →  run the harness
                                                                    ↓
                        settle or re-queue  ←  read the verdict
```

**Open the run row.** The manager keeps its own record of each run, beside the board's. Opening it clears everything the last attempt reported, so a row never mixes two attempts.

**Prompt and checkout.** Your phase builds the prompt (below). The checkout is derived from the task rather than looked up, so a run woken in a session that never saw the last attempt still lands in the same directory. It is held by a lease for as long as the run holds it.

**Run the harness.** Whichever one you handed it. The manager gives it a deadline.

**Read the verdict.** The handle carries two separate facts. `status` is whether the run terminated normally, and the manager's succeed-or-fail verdict is read from that alone. `outcome` is the run's own report of how it stopped, in a neutral vocabulary: `finished`, `stopped-at-limit`, `failed`, or `null` for no terminal result at all. Both are the framework's spelling rather than a vendor's, so two different harnesses settle identically.

**Settle or re-queue.** A run that terminated normally goes on to the phase's completion check, including one that reports `stopped-at-limit`. Pass the check and the row completes. A run that asked a question holds its task on the question instead. Anything else is a failed attempt, re-queued with the reason, until the retry budget runs out.

## Choosing the harness

The harness is a slot. You pass a factory; the manager calls it once and hands it four things.

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const manager = harnessManager({
  boardCollectionId,
  boardCollection: tasks,
  tenant,
  phase: implementPhase(),
  workspace: { root, sourceRepo, baseRef },
  runTimeoutMs: 30 * 60_000,
  harness: ({ cwd, resume, onSession, onUsage }) =>
    claudeCodeAgent({ cwd, resume, onSession, onUsage, detached: true, recordWork: true }),
});
```

Swapping Claude Code for Codex is that one line. Nothing else changes, and the
manager never learns which agent it is driving:

```ts
import { codexAgent } from "@flow-state-dev/codex";

harness: ({ cwd, resume, onSession }) =>
  codexAgent({ cwd, resume, onSession, thread: { sandboxMode: "workspace-write" } }),
```

What the factory passes on differs, because that part belongs to the agent. Claude
Code needs `detached: true`: it keeps session state by default, and a dispatched
row refuses a block that does. Codex keeps none, so it needs no equivalent. Each
spells its sandbox its own way. None of it reaches the manager.

**What the manager hands down.** `cwd` says where this run works: the checkout the manager derived and provisioned. `resume` says which conversation this attempt continues, or `null` for a fresh one. `onSession` is what the harness calls when it names its session, so the manager can record it. `onUsage` is what the harness calls with each subscription usage window its run reports, so the manager can store it in the run owner's [usage record](#subscription-usage). A harness that reports no usage, such as Codex, has no use for it. `onSteerable`, which is optional, is what a harness whose run can take a message mid-turn calls to offer the manager a way in; see [Steering a run](#steering-a-run).

**What the manager never does.** It does not read anything vendor-specific off the handle, and it does not tell the harness what model to use, what tools to allow, or how to sandbox itself. Those are yours, written inside the factory.

`HarnessFeeds`, exported from `@flow-state-dev/harness-manager`, types the feeds, and each signature is declared in `@flow-state-dev/core`. Any block that takes them and returns a conforming run handle is one this manager can drive. [Coding agents](/docs/tools/coding-agents) covers the contract in full.

## What a phase is

A phase is the part that knows what the work *is*: its name, how to build the prompt, and how to tell the job is finished.

```ts
const implementPhase = () => ({
  phase: "implement",
  buildPrompt: (run) =>
    `${run.task.goal}\n\nWork in ${run.workspacePath}, on branch ${run.branch}.`,
  isDone: (run) =>
    run.stopReport === "stopped-at-limit" ? false : pullRequestExists(run.branch),
});
```

`buildPrompt` runs on every attempt, from current state. `isDone` answers whether the job is actually finished. It is consulted only *after* a successful verdict, so a row completes only when both hold.

`run.task` is the row the manager claimed, as the board handed it over: its `goal`, and its `title`, `context`, `input`, `deps` and `priorWork` when the row has them. A field the row doesn't have is absent, not empty. `isDone` doesn't receive `run.task`.

It's the same on every attempt, so a retry or a run that resumes after someone's message starts from the same task. If a run needs something said in a conversation, write it on the task's `context` when you file it.

`isDone` gets one fact `buildPrompt` does not: `run.stopReport`, how the run itself said it stopped. It is the handle's `outcome`, `"finished"`, `"stopped-at-limit"` or `"failed"`, and it arrives exactly as the harness reported it. A value this version of the framework doesn't define reaches `isDone` unchanged, and never as `"finished"`. `null` means the run reported no terminal result at all, which is a different fact from finishing. What "done" means is entirely the phase's call.

Ending cleanly and finishing the job are two different answers. A run that exhausts its turn or spend budget commits the part it got through and reports `stopped-at-limit`. A completion check that answers from the branch alone (a commit exists, a pull request exists) settles that row as done with half the work in it. Reading `stopReport` is how a phase refuses that, as the sample above does.

If a phase reads collections of its own, ship them as a capability and put it on the manager's `uses`:

```ts
harnessManager({ …, uses: [myPhaseCapability] });
```

The manager installs it on the blocks a phase's hooks run inside, so `ctx.resources` resolves for them like any other block. A capability that claims one of the manager's own accessors is refused when you build the manager, naming the key.

## Asking and being answered

A run that needs a decision writes its question to a path the prompt names, and stops. Its work is saved, the checkout is let go, and **the task is held on the question**: it keeps its attempt, it has no lease, and nothing settles it or starts another run while the question is open. Nothing is spent while the user thinks. The question shows in the user's Inbox, and in the task's open holds when you read it with `getTask`.

The user answers from the Inbox, or by typing a line in the run's session (see [Talking to a run](#talking-to-a-run)). Either goes through the board's `updateTask` action, naming the question:

```ts
await updateTask_tasks({ id: task.id, question: hold.id, message: "Use the v2 endpoint" });
```

Once the task's last question is answered, the task takes one more turn on **the same attempt**, and that turn's run picks up **the same coding session**. Everything the run had worked out is still there. The phase's prompt builder runs again, and `run.answers` hands it the task's answered questions, oldest first, each with its answer. The run can ask again; each run writes its question to a path of its own, so it never re-reads one an earlier run asked.

**An answer spends no retry.** Budget your retries for failures alone.

A cancel while the task waits closes the question and starts nothing; what the run committed and the files it kept stay. A question waits until it is answered or the task is cancelled, unless the board's host sets a deadline: then, at the deadline, it closes with a "no answer came" message, and the next run goes on in the same session with it.

A [judge's](#checking-the-work-with-a-judge) *ask*, and saved work that doesn't match the run's record, ask the same way.

**A session the agent can't find is replaced.** The manager records only a session the harness *confirmed* it was in. If the agent can't find the session a run asked to continue, the next run starts a fresh one, with the brief, the question and the answer in its prompt.

## Reviewing a run's changes

Build the manager with `reviewChanges: true` and a user looks at a run's commits before its task completes. It's off by default.

```ts
harnessManager({ ledgers: conversationLedgers, judge: { block: answerJudge, floor: 0.6 }, reviewChanges: true /* , … */ });
```

A run's changes are the commits it made over the base its branch was cut from. A run is reviewed when it would otherwise complete (the [judge](#checking-the-work-with-a-judge) said done, there is no judge, or the judge's verdict fell under its floor) and its branch has commits. If git can't read the count, the run is reviewed anyway, and the review says the commits couldn't be read. A run with no commits completes without a review, and a failed run fails its attempt without one. A judge's confident verdicts skip the review: *not done* fails the attempt, and *ask* holds the task on a question.

While the review waits, the task stays `in_progress` on the same attempt and keeps its claim. The checkout is released. The user's Inbox lists it as a review titled "Review the run's changes". The prompt gives the number of commits and up to 20 of their subjects, then what the judge said: its verdict, confidence and reason, or "No judge read this run." The judge's verdict is information, not approval, and the prompt says so. On the task row, the review is an open hold with `source.kind: "suspension"` and `ask.kind: "review"` (see [A task waiting on a user](./task-board.md#a-task-waiting-on-a-user)), and its data carries `{ branch, commits, subjects, judge }`.

The user answers from the Inbox. A screen of your own answers with the Inbox client, and the answer must match `harnessReviewAnswerSchema`:

```ts
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";

const inbox = createInboxClient(client);

// Accept the changes
await inbox.answer(item, { value: { verdict: "accepted" } });

// Or ask for changes, in words
await inbox.answer(item, { value: { verdict: "revise", words: "Keep the old endpoint as a fallback." } });
```

A revision with blank words is refused with a 400, and the review stays open.

**Accepting** completes the task. No further run starts, and the output says `review: "accepted"`.

**Asking for changes** writes the words onto the task as that user's message, and one more run starts on the same attempt. It continues the same coding session with the words in its prompt, the way any [steer](#steering-a-run) is taken. If it commits again, it's reviewed again, and the new review counts every commit on the branch. Each request for changes counts toward the task's message limit, and past that limit the attempt fails. If the harness never confirmed a coding session, asking for changes fails the attempt instead, and the next attempt's brief carries the words.

**A review has no deadline** unless the host sets `userDeadlineMs` (see [runtime configuration](/docs/configuration/runtime#createflowstate-fields)). At the deadline the task completes with no further run, and the output says `review: "deadline"`. Show that as not reviewed, never as approved. Without a review, or with the option off, `review` is `null`.

**A cancel while the review waits** closes it and starts nothing. The branch's commits and the run's kept files stay.

Reviews need a host with [durable execution](../advanced/durable-execution.md). A host can restart while a review waits. The answer picks the run back up.

## Running tasks from more than one board

A manager built with `boardCollectionId` works one board. A worker that also takes tasks a coordinator files in a conversation needs more. Each conversation keeps its own board, the list of tasks filed from it, so there is no single board to name.

Give the manager `ledgers` instead. It's a function that finds a board by the id and partition the task's claim names, and returns `undefined` for any board the worker shouldn't read:

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { conversationLedgers } from "@flow-state-dev/workforce";

const answering = harnessManager({
  ledgers: conversationLedgers,
  tenant: undefined,
  phase: answerPhase(),
  workspace,
  runTimeoutMs: 30 * 60_000,
  harness,
});
```

`conversationLedgers` comes from Workforce. It finds the board of the conversation the task came from, for the user the run belongs to, and nothing else. The manager reads the board and partition from the claim, never from the task. Each run's checkout, branch and run record are kept apart by board and partition, so two conversations that file the same task never share a tree. Pass `boardCollectionId` as well, and the manager also runs that board's rows.

A task from a conversation usually carries a goal and no `issue` or `phase`. The manager then uses the task's id in their place. A task that names only one of the two is refused. A completed run's output carries the agent's last message as `answer` (up to 8,000 characters), the run's `branch`, or `null` when it worked on files alone, and how many `commits` it made. With [`reviewChanges`](#reviewing-a-runs-changes) on, `review` says how the review ended.

A run refused before it starts (no project, a remote the host doesn't allow) fails a conversation's task for good, so the conversation hears why; on a fixed board the row is cancelled. A question the run asks holds the task on it, the same on either kind of board (see [Asking and being answered](#asking-and-being-answered)).

### Checking the work with a judge

You can also give the manager a `judge`: an evaluator block that reads a task's goal, the run's answer and its commits, and answers done, not done or ask, with a `confidence`. You set a confidence `floor` beside it. It runs after the phase's own check passes, and only for a task that has a goal, on a board read from the claim. *Done* closes the task. *Not done* fails the attempt, and the next attempt's prompt carries the judge's reason. *Ask* puts a question to the user, the same way a question from the run does. A verdict below the floor counts as done, and a judge that fails never fails the task: the task settles on the phase's check, and its output says `judged: false`.

```ts
harnessManager({ ledgers: conversationLedgers, judge: { block: answerJudge, floor: 0.6 } /* , … */ });
```

`confidence` and `floor` run from 0 to 1. A judge adds a step after the completion check, so pass `judge: true` to `harnessDrainBudgetMs` when you size your shutdown.

## Talking to a run

A user talks to a coding run by typing in the run's own session, the one the task's run link names. What a line does depends on whether the task has finished.

**While the task is open, a line steers it.** The line is kept on the task as a message from that user, the same write as `updateTask({ message })` (see [Sending a message to an open task](./task-board.md#sending-a-message-to-an-open-task)). The run takes it at its next step: the same request runs another step that resumes **the same coding session** with the message in its prompt. The checkout and the harness's memory of the conversation carry over, so the run picks up with what it had already read and tried, plus what you said. No attempt is used. A follow-up filed on the task and still waiting to start counts as open: the line goes to it.

**Once the task and its follow-ups have finished, a line is talk.** One harness run resumes the task's coding session with the line, and its answer is the reply in the session. It runs outside any attempt: the task, its output and its attempts don't change. It holds the checkout while it runs, as any run does. To change the work, file a follow-up task.

### Steering a run

By default a step that is running finishes first, and the next step takes the message. If your harness's abort resolves only once its process has exited, build the manager with `stopsOnAbort: true`. The manager then checks the task about once a second while a step runs, and once the harness has confirmed a coding session to resume, a new message stops the running step, and the next step starts at once with it. A message that arrives before then waits for the step's own end. The stop costs the step the run was in the middle of; the checkout keeps whatever it wrote. Leave `stopsOnAbort` off for a harness whose abort can return while its process still runs, so two processes never work one checkout.

A message that arrives after the run's last step, even while its result is being checked, gets one more step before the task settles. That step resumes the coding session the run confirmed, so it needs one: if the harness never confirmed a session, the message is left on the task unread, and only the late-message turn below (`STEER_TURN_ENTRY`) acts on it. A host that doesn't declare that entry completes the task without it. The first attempt of a task filed with messages already on it carries them all in its prompt. A message the run takes mid-run shows in its session as a line from its sender.

**A run that takes a message live.** Some harnesses can hand a message to the turn already running. Cursor can today; Claude Code and Codex can't yet. Pass the slot's `onSteerable` through to such a harness and the manager checks the task about once a second while the step runs, handing each new message straight to the running turn. The step keeps going with it: no stop, no extra step, no new attempt. If the run turns a message away, the message isn't lost. The next step takes it, as if it had arrived after this one, or at once under `stopsOnAbort: true`. A message whose delivery was still unanswered when the step ended goes to the next step too, with a note to the agent that it may already have it. Messages owed that way are held in the server's memory, so a server that dies mid-step loses them.

If the task is cancelled, finishes, or is claimed again while a step runs, the request runs no further step for it.

### The session door

Build the action with `harnessSessionDoor`, declare it on the coding flow, and give it the same harness slot the managers use. `board` finds, from the calling session's own fields, the board its run is on:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { harnessManager, harnessSessionDoor } from "@flow-state-dev/harness-manager";
import {
  conversationLedgers,
  filingConversationBoard,
  startOwedSteerTurn,
  STEER_TURN_ENTRY,
  steerTurnEntry,
  workerTaskEntry,
} from "@flow-state-dev/workforce";

const manager = harnessManager({ ledgers: conversationLedgers, harness /* , phase, workspace, … */ });
const runOf = (row) => ({ issue: row.id, phase: "answer" });

defineFlow({
  kind: "coder",
  actions: {
    message: harnessSessionDoor({
      name: "coder",
      harness,
      board: async (ctx) => {
        const filed = await filingConversationBoard(ctx);
        return filed === undefined ? undefined : { tasks: filed.tasks, runOf };
      },
      onSteered: (ctx, row) => startOwedSteerTurn(ctx, row),
    }),
  },
  internal: {
    actions: { [STEER_TURN_ENTRY]: steerTurnEntry({ name: "coder-steer-turn", block: manager }) },
  },
  task: { actions: { work: workerTaskEntry({ name: "coder-work", block: manager }) } },
});
```

- `runOf` names the issue and phase a row's run is keyed by, the values the manager keys its run record by, or `undefined` for a row no manager behind this door runs.
- `onSteered` starts the turn a message is owed when the task was running nothing because it was waiting on work it filed.
- The internal `STEER_TURN_ENTRY` entry runs the turn a late message is owed: the task again, on the same attempt.

Call `message` with `{ message }` on the run's session. The line goes into the session as the user's message when the action starts, so a UI can show it as delivered by reading the session. It answers `{ steered: <taskId> }` for a steer and `{ reply, taskId }` for talk. A refusal fails the request, with the reason in words as the error's message and `SessionDoorRefused` as its cause, so only a delivered line ever completes:

| The session | Refused with |
|---|---|
| Has no task that started in it | `not-started` |
| Holds a finished task whose harness never confirmed a coding session | `cannot-continue` |
| Holds a task that can take no more messages (20) | `steer-limit` |
| Holds a task that finished before the line reached it | `finished` |
| Is on a board that keeps no messages | `not-supported` |

**A line doesn't spend a retry.** While the task is held on a question, a line answers its oldest open question, and the turn that answer owes resumes the coding session, as an answer from the Inbox does.

**Only the run's own user can send one.** The session belongs to them, so anyone else is refused before the line is written.

## The checkout

Each task gets its own directory, derived from who the run belongs to plus the board, the issue and the phase. Any later session works out the same path from the same inputs, without looking it up.

The board can be any task collection. A board id with dots in it, like `eng.feature.work`, is accepted as is, and the manager names the folder and branch with it. An id git can't use in a branch name, such as one ending in `.lock`, is refused when the manager is built. Two boards whose ids differ other than in letter case never end up in the same checkout. On a board kept for a whole organization, a row's run belongs to the user who started it, and another user's drain doesn't run it. Give the draining board `runOwnerDispatcher()` and that drain leaves the row untouched, without spending one of its attempts.

A **lease** keeps two attempts out of one tree: a lock file beside the checkout, taken before the tree is provisioned and released on every exit. A process that was displaced never removes its replacement's lock.

The lease is not a mutex. Checking the lock and removing it are two steps, so a lock whose holder has died is reclaimed after a stale window rather than instantly. The manager refuses a configuration that shortens that window below the longest a live attempt can hold the lock.

A checkout lives on the machine that made it, unless you give the manager somewhere to save it. With a workspace host from `@flow-state-dev/workspace` that has a held-work store, and a source that returns a `heldPrefix` for the run (the key prefix its work is stored under), the manager saves the run's commits and uncommitted changes at the end of each turn and when the harness fails. A retry that lands on another machine gets the checkout back from the last save, with the changes unstaged, and the coding agent starts a fresh conversation there. If the saved work doesn't match the run's record, the harness doesn't run: the task is held on a question for the run's owner, naming what disagreed. The run record's `place` and `held` fields show which machine the run is on and what the last save held. The package README's [Running a project's work](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/harness-manager/README.md#running-a-projects-work) has the setup.

## The deadline

`runTimeoutMs` bounds **the harness step**. The manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half, and all it promises.

How promptly the harness then returns is the harness's own business, and harnesses differ. Neither bounds what the run *spawned*: a command the agent's process started can outlive the kill. The sandbox you configure on the harness is the fence for a runaway command, not this deadline.

## Subscription usage

A coding agent on a subscription plan stops working when one of its limit windows
runs out. `harnessUsageAction` gives a flow one query, `harnessUsage`, that says
how much of each window a user has used and how old that reading is. Hand it a
[usage reader](/docs/tools/coding-agents#subscription-usage) per harness, keyed
by the harness's name, and put it on one flow, the one your screens and workers call:

```ts
import { defineFlow, harnessEnv } from "@flow-state-dev/core";
import { readCodexUsage } from "@flow-state-dev/codex";
import { harnessUsageAction } from "@flow-state-dev/harness-manager";

const env = harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] });

defineFlow({
  kind: "projects",
  actions: {
    harnessUsage: harnessUsageAction({
      readers: { codex: (options) => readCodexUsage({ env, ...options }) },
    }),
  },
});
```

Call it with `{ refresh?: boolean }`. It answers `{ harnesses }`, one row per
harness, sorted by name:

```ts
{
  harness: "codex",
  status: "windows",         // or "api-key", "signed-out", "unavailable"
  reason: null,              // why there is no number, for the other three
  plan: "plus",
  windows: [
    { id: "codex:primary", label: null, minutes: 300, usedPercent: 42, level: null, resetsAt: 1798020000000,
      checkedAt: 1798012000000, origin: "read", ageMs: 65000, rolledOver: false },
  ],
  checkedAt: 1798012000000,  // when the stored reading was made, or null
  ageMs: 65000,              // how old it is, or null
  refreshError: null,        // why the last refresh failed, or null
}
```

A window's `origin` says how it arrived: `"read"` when a reader fetched it on a
refresh, `"run"` when a run reported it through `onUsage`. Each window carries
its own `checkedAt` and `ageMs`. The row's `checkedAt` and `ageMs` belong to the
last reading, so a harness that has only run windows and was never read has a
row `checkedAt` of `null`, and each window says how old it is.

**Run windows land on their own.** Pass the slot's `onUsage` through to a
harness that reports usage, as the Claude Code example in
[Choosing the harness](#choosing-the-harness) does, and every window a
run reports is stored for the user the run belongs to. A line sent through the
[session door](#the-session-door) stores its run's windows for the user
talking. For Claude Code, register
[`readClaudeUsage`](/docs/tools/claude-code-sdk#reading-usage-left) as the
`claude-code` reader. It supplies the account and plan, and the windows come
from runs:

```ts
import { readClaudeUsage } from "@flow-state-dev/claude-code/sdk";

const claudeEnv = harnessEnv({ pass: ["PATH", "HOME", "CLAUDE_CODE_OAUTH_TOKEN"] });

harnessUsageAction({
  readers: {
    codex: (options) => readCodexUsage({ env, ...options }),
    "claude-code": (options) => readClaudeUsage({ env: claudeEnv, ...options }),
  },
});
```

**Without `refresh`, nothing is read.** The query returns what is stored.
A harness with a reader and no reading yet is listed with `status: "unavailable"`,
`reason: "Not checked yet"` and no windows.

**`refresh: true` asks the readers first**, at most once a minute per user and
harness (`USAGE_REFRESH_EVERY_MS`). The minute counts from the last attempt,
whether it worked or not. Refreshes that arrive together share one call. A
reader that throws, or takes longer than `timeoutMs` (default
`USAGE_READ_TIMEOUT_MS`, 10 seconds), still gets an answer: the stored reading
stays and `refreshError` says why.

**Ages come from the server.** `ageMs` and `rolledOver` are worked out when the
query runs, by the server's clock. A window whose `resetsAt` has passed reads
`rolledOver: true`; its percent is from before the reset, so show the reset
rather than the number.

**One current record per user and harness.** A reader's result and the
windows runs reported sit side by side:

- A reading replaces the windows the last reading left and keeps the run windows it doesn't name. Where both name one window, the newer wins.
- A newer report for a window replaces the older one. An older one that arrives late is ignored, and so is a reading older than the stored one.
- A reading or run window from a different account clears every window and the plan the earlier account left.
- A reading with no number (`api-key`, `signed-out`) clears every window. A run that started before that reading doesn't bring them back.

The account is kept only as a hash, with no email. There is no history.

The readings live in `harnessUsageCollection` (`harness-usage/**`, user scope).
A client can't read the collection directly. Read it through the `harnessUsage`
query. On the server:

- `readHarnessUsage(ctx, now, expected?)` returns the same rows the query does, without refreshing.
- `recordHarnessUsage(ctx, report)` stores one window a run reported, a `HarnessUsageReport`. The manager's and the session door's `onUsage` call it for you.
- `recordHarnessUsage(ctx, harness, reading, checkedAt)` stores a whole reading made at `checkedAt`.

Both forms answer `"recorded"`, `"kept-stored"` (an `unavailable` reading over a stored one, which stays) or `"refused-older"` (what is stored is newer, or the run started before the stored no-number reading).

All of these read the collection through the calling block's resources, under the key `HARNESS_USAGE`, and throw when it isn't installed there: give that block `resources: { [HARNESS_USAGE]: harnessUsageCollection }`. `harnessUsageAction` installs it on its own block.

## Pointing it away from your own code

`assertDistinctRepository` refuses a source repository that is the host's own.
Tell it where the host lives:

```ts
assertDistinctRepository("sourceRepo", sourceRepo, process.cwd());
```

Pass the directory your code lives in, a list if it spans several, or `[]` if
this host has no repository of its own, such as a built artifact in a container.
`[]` is supported; it just has to be stated.

Given a location it cannot resolve to a repository, it refuses.

## What stays with you

The manager runs a claimed row. Everything around that is the host's: putting rows on the board in the first place, waking it, reading status back, and whatever check tells a phase the job is done.

Seeding a row means knowing what your issues are called, and a completion check means knowing what "finished" looks like in your world.

## What you import

The package has two entry points, and the difference is what it promises to keep
stable.

`@flow-state-dev/harness-manager` is the supported host API: everything above,
plus the pieces you need around it: `harnessManager` and its options,
`harnessSessionDoor`, `harnessReviewAnswerSchema` and `HarnessReviewAnswer`, `PhaseSpec`
and the run-context types, `WorkspaceConfig`, the construction-time guards
(`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`,
`assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing
your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per
organization, the run-record collection for building a status
surface (a run's questions are on its task's row), and the [usage query](#subscription-usage) with its collection and
helpers.

`@flow-state-dev/harness-manager/checkout` is how a run gets a directory:
`provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the
path grammar. It is not part of the versioned contract, so don't build a host on
it. Everything in it is specific to git worktrees. Build on `harnessManager({ harness })` and let the manager own the checkout. A
status page or a cleanup job reads `workspacePath` and `branch` off the run
record instead of deriving them again.

If the coding agent switches its checkout to another branch, the next attempt still runs on the run's own branch, and the agent's branch is kept. When the agent's branch has everything the run's branch has, the run's branch fast-forwards to it and no files change. When it doesn't, the run's branch is checked out again. The manager never commits for the agent, though: if the agent left uncommitted changes on its other branch, the checkout stays as it is and the row settles as refused, with a message saying to commit, stash or discard the changes, or switch back. The same happens if the agent left a merge or rebase half done, and then the message names the git command to run in the checkout.

## Limits

- **Saving work across machines is opt-in.** Without a held-work store, a run's checkout exists only on the machine that made it, and a retry that lands elsewhere starts from the base branch. A run whose record says its work was saved, with no store and no live checkout on this machine, asks its owner rather than starting over.
- **A turn in progress can be lost.** Work is saved when a turn ends, so a machine that dies mid-turn loses that turn.
- **A repository on the host's own disk is never saved.** A run cut from a repository listed in `localRepositories` on `localWorkspaceHost` works in that repository directly, and its work stays on that machine.
- **Usage rows are keyed by the bare user id.** Where one user id is reachable from two tenants, both see that user's usage row: their plan and percents, with no email.
- **No retention policy.** Run records grow without bound. Fine for a board driving a few tasks; a long-lived one needs pruning, which is not built.
- **A harness that can't resume can't be talked to once finished.** Talk resumes the coding session the run confirmed, so a finished run whose harness never confirmed one is refused (`cannot-continue`). A steer to an open task needs no session to be kept, but the step that takes it resumes one: on a run with none confirmed, only the late-message turn (`STEER_TURN_ENTRY`) acts on it.
- **Reviewing changes needs durable execution.** On a host without it, a manager built with `reviewChanges: true` refuses each run before the harness starts, and cancels the task with a message naming durable execution.
- **Git worktrees for a repository.** A run on a repository works in a `git worktree` of it. Where the repository comes from is up to the workspace host you pass as `workspace`; see the package README's "Running a project's work". For a project's work, Workforce's `projectWorkspace` is that source: see [A project's code and files](../workforce/projects.md#coding-work-in-a-project).

## Related pages

- [Task board](./task-board) — the primitive this worker runs on.
- [Work that outlives the turn](/guides/background-work) — how a claimed row reaches a session of its own.
- [Coding agents](../tools/coding-agents) — the harness contract, and the handle the verdict is read from.
- [Claude Code SDK agent](../tools/claude-code-sdk) — one harness, and the `cwd` / `resume` / `onSession` options the slot feeds.
- [Codex SDK agent](../tools/codex) and [Cursor SDK agent](../tools/cursor) — the other harnesses that fit the slot.
