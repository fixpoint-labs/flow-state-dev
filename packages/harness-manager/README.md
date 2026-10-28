# @flow-state-dev/harness-manager

A task-board worker that turns a row into a **supervised coding run**: its own checkout, a verdict read before the row settles, a question it can ask a user, and the coding agent itself as a slot you fill.

A *harness* is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing the run. This package imports none of them.

## Installation

```bash
pnpm add @flow-state-dev/harness-manager
```

Peer of `@flow-state-dev/core` and `@flow-state-dev/orchestration`. You install a harness separately: `@flow-state-dev/claude-code`, `@flow-state-dev/codex`, `@flow-state-dev/cursor`, or your own.

## Quick start

```ts
import { harnessManager } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";

const manager = harnessManager({
  boardCollectionId,          // the board's ledger collection id
  boardCollection: tasks,     // the same declaration the board registers
  tenant,                     // the tenant this manager serves; every request must match
  phase: implementPhase(),    // prompt builder + done-condition
  workspace: { root, sourceRepo, baseRef },
  runTimeoutMs: 30 * 60_000,

  // The slot. Called once; the manager hands down its feeds.
  harness: ({ cwd, resume, onSession, onUsage }) =>
    claudeCodeAgent({ cwd, resume, onSession, onUsage, detached: true, recordWork: true }),
});
```

Mount it as the block behind a board worker that dispatches, and rows filed on that board become supervised runs.

With `workspace: { root, sourceRepo, baseRef }`, every run gets a new branch of `sourceRepo`, cut from `baseRef`. The branch lives in `sourceRepo` itself and the run's checkout sits under `root`.

## Running a project's work

Hand the manager a workspace host instead of a fixed repository, and each run gets its files from whatever the host's source says. A *workspace host* turns a run's source into a directory the agent works in, and saves the files kept with it; a *run source* says where those files come from. Both come from `@flow-state-dev/workspace`:

```ts
import { localWorkspaceHost } from "@flow-state-dev/workspace";

harnessManager({
  boardCollectionId: "eng.feature.work",
  boardCollection: work,
  workspace: localWorkspaceHost({
    root: "/var/fsd/runs",
    remotes: { allow: ["github.com"] },
    source: (ctx) => ({ kind: "repo", repo: "https://github.com/acme/storefront.git" }),
  }),
  // ...
});
```

For a run on a Workforce project, `@flow-state-dev/workforce` provides the source: `projectWorkspace()` answers with the repository of the project the run works for (its workstream's, its conversation's, or the one its task names), with the project's files beside the checkout, or the project's files alone when it has none. It reads its collections through `projectWorkspaceCapability`, which goes on the manager's `uses`:

```ts
import { projectWorkspace, projectWorkspaceCapability } from "@flow-state-dev/workforce";

harnessManager({
  // ...
  workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace() }),
  uses: [projectWorkspaceCapability],
});
```

The source answers per run, from the block context, and it is asked when a run is first set up. The repository and base branch it named are recorded on the run record (`remote`, `baseRef`). A retry uses the recorded ones, so changing where a source points applies to new rows and never moves a run already under way. A run that started with no repository is recorded as one (`filesOnly`), so it stays on its kept files even if its project gains a repository later.

When the run has files kept beside its checkout, the manager saves them at the end of each turn, when the run asks a question, and when the harness fails. The run record's `lastSave` shows the result: the time, any files left alone because someone else changed them too, and an error if the save failed. In a run with no repository, the manager's question file stays out of the saved files.

The manager can also save a run's repository work, its commits and its uncommitted changes, so another machine can pick the run up. Give `localWorkspaceHost` a held-work store as `heldWork`, and have your source return a `heldPrefix` with the repository, such as `{ kind: "repo", repo, heldPrefix: "runs/storefront" }`. The prefix is the key prefix the run's work is stored under, and a run without one is never saved. The manager saves it at the same points as the kept files: the end of each turn, a turn that ends in a question included, and when the harness fails. An attempt that lands on another machine gets its checkout rebuilt from the last save, with the same commits and the changes unstaged. The coding agent starts a fresh conversation there and is told what was restored. Submodules and files over 10 MB are left out. Setting up the store is covered in the workspace README's [Holding a run's work across machines](../workspace/README.md#holding-a-runs-work-across-machines).

The run record shows where that stands. `place` names the machine the run is on and its `state`: `provisioning`, `ready`, `lost`, `restoring` or `refused`. `held` describes the last save: the attempt, the time, the base, head and snapshot commits, the key it's stored under, the paths left out and why (`skipped`), and `error` when the last save failed. Each save of repository work is tried a few times before it counts as failed.

A failed save of either kind, kept files or repository work, doesn't fail the run, and the next save point tries again. The exception is an attempt that would complete: completing is its last save point, so it fails instead and the retry saves the work.

If the saved work doesn't match the run's record, the harness doesn't run. The task is held on a question for the run's owner, naming what disagreed, and `place.state` is `lost`. Nothing saved is changed or deleted. Once the owner answers, the next run, on the same attempt, starts from its base, with the saved files in `held/` beside the checkout when they can be read.

Without a held-work store, nothing is saved and the record gets no `place` or `held`. A run whose record says its work was saved, with no live checkout on this machine, asks its owner the same way rather than starting over.

A run its workspace refuses is not retried. That covers a source answering `refused` and a host that won't provision what the source named, such as a remote it doesn't allow. The row is cancelled on its first attempt, before the harness starts, with the refusal as its reason.

## Running a board kept per organization

To run an org-scoped board's rows as supervised coding runs, hand the manager that board and its id:

```ts
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, runOwnerDispatcher } from "@flow-state-dev/harness-manager";

const work = defineTaskCollection({ id: "eng.feature.work", scope: "org" });

const manager = harnessManager({
  boardCollectionId: "eng.feature.work",
  boardCollection: work,
  // ...the rest as above
});

// On the board that drains the rows:
taskBoard({ collection: work, dispatcher: runOwnerDispatcher(), /* ... */ });
```

The manager builds each run's checkout folder and git branch from the board's id, used as is. An
id with dots in it is accepted. The manager refuses, when you build it, an id git can't use as a
branch name, such as one ending in `.lock`. Two boards whose ids differ other than in letter case
never share a checkout.

The board is kept per organization, so everyone in the organization sees its rows. A row's
coding run belongs to the user who started it: a drain by anyone else in the organization is
refused, naming whose run it is. Their own retry picks up the same checkout, branch and agent
session. With `runOwnerDispatcher()` on the draining board, the refusal happens before the row
is claimed and costs it no attempt. Without it the manager still refuses to run someone else's
row, but only after the claim, so the row is charged an attempt.

**Wire `runOwnerDispatcher()` on every board kept per organization that drains rows into a
manager.** The manager's own refusal keeps the run from being split between two people, but only
the dispatcher keeps a teammate's drain from spending the row's retries. The dispatcher claims in
the board's own readiness and order, so it takes the place of any other dispatcher on that board.

## Running a conversation's tasks

A worker can also take tasks a coordinator files in a conversation. Each conversation keeps its
own board, so there is no single board to name. Give the manager `ledgers` instead: a function
that finds a board by the ledger id and partition the task's claim names, and returns
`undefined` for any board the worker shouldn't read. It has the same shape as orchestration's
`taskLedgers` resolver, so one function can serve both.

```ts
import { harnessManager, type HarnessLedgers } from "@flow-state-dev/harness-manager";

const ledgers: HarnessLedgers = async (ledgerId, ctx, partition) =>
  ledgerId === "tasks" && partition !== undefined ? conversationBoard(ctx, partition) : undefined;

const manager = harnessManager({
  ledgers,
  judge: { block: answerJudge, floor: 0.6 }, // optional, see below
  // ...the rest as above
});
```

The task's entry hands the manager the claim on its input, as `claim: { collectionId,
partition, incarnationId }`. The manager never trusts it by itself: the row at that ledger and
partition must be this task, on this attempt, still running, before anything runs, and every
later write is checked against it again. Each run's checkout, branch and run record are kept
apart by board and partition (`runBoardSegment`), so two conversations that file the same task
id never share a tree. Pass `boardCollectionId` and `boardCollection` too and the manager also
runs that board's rows.

The manager calls `ledgers` on every checked write, not once per run, so keep it cheap. For a
user's line into such a run, declare [`harnessSessionDoor`](#talking-to-a-run) on the flow.

On such a board, a task that names no `issue` or `phase` runs as the manager's phase, with its
task id in their place, and a task naming only one of the two is refused. A task naming both is
feature work in that phase, and its run is keyed by its task id, not by the issue: the board
mints its own task ids, so its id needn't be the one `{ issue, phase }` derives, and two tasks
naming one issue still get a tree each. A fixed board runs feature rows only, and refuses a
row whose id isn't the one its payload derives.

A completed run's output carries `answer`, the agent's last message (up to 8,000 characters),
the run's `branch` (`null` for a run with only kept files), how many `commits` it made, and
`judged`. A feature row's output gains the same fields.

On a board read from the claim:

- **A refused run fails the task for good** (`errored`, never retried), so the conversation
  hears why. On a fixed board it is cancelled.
- **A judge, when you give one, reads the run** after the phase's own check passes, for a task
  with a goal. It is your block, typically an evaluator, handed `{ goal, answer, commits: {
  count, subjects } }` and answering `{ verdict: "done" | "not-done" | "ask", confidence,
  reason }`. *Not done* fails the attempt and the next prompt carries the reason; *ask* holds
  the task on the reason as a question, as a run's own question does
  ([Continuing a run](#continuing-a-run)). A verdict under `floor` counts as done. `confidence`
  and `floor` run from 0 to 1; a confidence outside that is not a verdict. A judge
  that fails never fails the task: it settles on the phase's check, with `judged: false`. Size
  your shutdown with `harnessDrainBudgetMs({ ..., judge: true })`.

See [Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) for the whole
picture.

## The slot

The manager calls your factory once, with five feeds (`HarnessFeeds`):

| Feed | What it does |
|---|---|
| `cwd` | Where this run works: the checkout the manager derived and provisioned. |
| `resume` | Which session this attempt continues, or `null` for a fresh one. |
| `onSession` | Called by the harness when it names its session, so the manager records it. |
| `onSteerable` | Called by a harness whose run can take a line mid-turn, with the run's `steer` while it can and `null` after, so a steer reaches the step [as it runs](#a-run-that-takes-a-steer-live). Optional; a harness that can't steer ignores it. |
| `onUsage` | Called by the harness with each subscription usage window its run reports, so the manager stores it in the run owner's [usage record](#subscription-usage). A harness that reports no usage ignores it. |

They are the harness contract's own signatures, declared in `@flow-state-dev/core`. Each is handed the block's context, not the run's prompt.

Everything else about the agent (model, tools, permissions, sandbox) you write inside the factory. Pointing the same manager at another harness is one line, and the manager is unchanged:

```ts
import { codexAgent } from "@flow-state-dev/codex";

harness: ({ cwd, resume, onSession }) =>
  codexAgent({ cwd, resume, onSession, thread: { sandboxMode: "workspace-write" } }),
```

```ts
import { cursorAgent } from "@flow-state-dev/cursor";

harness: ({ cwd, resume, onSession, onSteerable }) =>
  cursorAgent({ cwd, resume, onSession, onSteerable, agent: { model: { id: "composer-2.5" } } }),
```

Any block that takes the feeds and returns a run handle conforming to `@flow-state-dev/core`'s harness contract is one this manager can drive.

Claude Code needs `detached: true`. Leave it out and your flow fails to build, naming the entry. Codex and Cursor need no equivalent.

## What a phase supplies

```ts
{
  phase: "implement",
  buildPrompt: (run) =>
    `${run.task.goal}\n\nWork in ${run.workspacePath}, on branch ${run.branch}.`,
  isDone:      (run) =>
    run.stopReport === "stopped-at-limit" ? false : pullRequestExists(run.branch),
  validate:    (workspace) => checkWhateverThisPhaseNeeds(workspace),  // optional
}
```

`buildPrompt` is rebuilt on every attempt from current state. `isDone` is consulted only after a successful verdict, which the manager reads from the handle's `status`. Completion is a conjunction, never an alternative route. `validate` runs once at construction and whatever it returns reaches the phase's own hooks, which is how a phase carries something it learned at startup into a run.

`run.task` is the claimed row's brief: `goal`, plus `title`, `context`, `input`, `deps` and `priorWork` when present. Build the prompt from it rather than from `run.issue`, which is only the row's identity.

`isDone` gets one fact `buildPrompt` does not: `run.stopReport`, how the run said it stopped, in the framework's own vocabulary (`"finished"`, `"stopped-at-limit"`, `"failed"`) and exactly as the harness reported it. A value this version of the framework doesn't define reaches `isDone` unchanged, and never as `"finished"`. `null` means no terminal result was reported at all. What "done" means is entirely the phase's call.

Ending cleanly is not the same answer as finishing the job. A run that exhausts its turn or spend budget commits the part it got through and reports `stopped-at-limit`. A check that only asks whether the branch has a pull request settles that row as done with half the work in it.

Collections a phase reads ride the standard `uses` option:

```ts
harnessManager({ …, uses: [myPhaseCapability] });
```

A capability claiming one of the manager's own accessors (`runs`, `harness-usage`, the board's ledger) is refused when you build the manager, naming the key.

## Continuing a run

A run that needs a decision writes its question to the file its prompt names (`run.askMarkerPath`) and stops. Its task is then held on the question: it stays on its attempt, its lease is dropped, and nothing settles it or starts another run while the question is open. Its work is saved first, and the checkout is free. The Inbox lists the held task as a question, and the board's own `getTask` shows it among the task's open holds.

The answer goes through the board's `updateTask` action, naming the question, as the Inbox sends it:

```ts
await updateTask_tasks({ id: task.id, question: hold.id, message: "Use the v2 endpoint" });
```

A line the user types in the run's session answers the task's oldest open question the same way (see [Talking to a run](#talking-to-a-run)). Once its last question is answered, the task takes one more turn **on the same attempt**: no retry is spent. That turn's run **continues the same coding session**. Its prompt is the phase's `buildPrompt` again, with `run.answers` holding the task's answered questions, oldest first, each with its answer. A run may ask again, and the next answer works the same way. Each run writes its question to a path of its own (`.fsdev/ask/<attempt>-<run>.md`), so a run never reads a question an earlier one already asked.

A cancel while the task waits closes the question and starts nothing: what the run committed stays on its branch, and its kept files stay saved. A question has no deadline unless the host sets one on the board; at a deadline it closes with a "no answer came" message, and the next run goes on in the same session with it.

The judge's *ask*, and held work that doesn't match its record, ask the same way.

The recorded session is the one the harness *confirmed* it was in. If the agent can't find that session, the next run starts a fresh one, with the brief, the question and the answer in its prompt.

### Upgrading from the question inbox

- The manager keeps no questions of its own. Removed: `askQuestion`, `answerQuestion`, `listQuestions`, `readQuestion`, `withdrawQuestion`, `inboxCollection`, `INBOX`, `questionTopic`, `questionFingerprint`, `parseQuestionTopic`, `HarnessRunParked` and the `QuestionAnnouncement` type.
- `harnessManager({ announce })` is refused at construction. Read held tasks from the board (its rows' open holds, `openRowHolds`) and answer with its `updateTask` action.
- `run.answers` reads the task's answered questions from its row.
- `run.askMarkerPath` is `.fsdev/ask/<attempt>-<run>.md`. A phase that names a path of its own must use the one it is handed.
- `askMarkerPath(path, attempt, run)` and `readAskMarker(path, attempt, run)` take the run.

## Talking to a run

A user talks to a coding run by typing in the run's own session. `harnessSessionDoor` builds the public action a coding flow declares for that line. One door serves every manager on the flow, and the board the calling session's run is on is resolved per request, from server state:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { harnessManager, harnessSessionDoor, taskIssueSegment } from "@flow-state-dev/harness-manager";
import {
  conversationLedgers,
  filingConversationBoard,
  startOwedSteerTurn,
  STEER_TURN_ENTRY,
  steerTurnEntry,
  workerTaskEntry,
} from "@flow-state-dev/workforce";

// `harness` is the slot both the manager and the door are given.
const manager = harnessManager({ ledgers: conversationLedgers, harness /* , phase, workspace, … */ });
const runOf = (row) => ({ issue: taskIssueSegment(row.id), phase: "answer" });

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
      // A steer to a task running nothing (waiting on work it filed) starts the turn it is owed.
      onSteered: (ctx, row) => startOwedSteerTurn(ctx, row),
    }),
  },
  internal: {
    // The turn a steer that missed the run's last step is owed: the task again, on its attempt.
    actions: { [STEER_TURN_ENTRY]: steerTurnEntry({ name: "coder-steer-turn", block: manager }) },
  },
  task: { actions: { work: workerTaskEntry({ name: "coder-work", block: manager }) } },
});
```

The session's task is found in the chain of the task that ran there (the task and its follow-ups, which run in the session one at a time), the way Workforce's door finds it: the open one running here, else the latest open one, a follow-up waiting to start, else the latest that ran here. Sent `{ message }`, the door writes the line into the session as the user's message, then:

- **open task** → a steer. The line is kept on the task as a message from the user (`Task.steers`, the same write as `updateTask({ message })`). The run takes it at its next step: the same request runs another step that resumes the coding session the last one confirmed, with the steer in its prompt, on the same attempt. A steer that lands after the run's last step gets one more turn before the task settles, through `STEER_TURN_ENTRY`. While the task is held on a question, the line answers its oldest open question instead, and the turn the answer owes resumes the coding session ([Continuing a run](#continuing-a-run)). Answers `{ steered: <taskId> }`.
- **every task in the chain finished** → talk. One harness run resumes the task's confirmed coding session with the line, outside any attempt, and its answer is the reply. It holds the checkout while it runs, as a run does, so a follow-up claimed meanwhile waits for it; `talkTimeoutMs` (default 10 minutes) bounds it. The task, its output and its attempts don't change. Answers `{ reply, taskId }`.

A refusal fails the request, with the reason in words as the error's message and `SessionDoorRefused` as its cause, so only a delivered line ever completes:

- `not-started`: no task started in this session.
- `cannot-continue`: the task finished and its harness never confirmed a coding session.
- `steer-limit`: the task has taken as many messages as it can (20).
- `finished`: the task finished before the line reached it.
- `not-supported`: the board keeps no messages.

The last three read as they do on Workforce's door (`LINE_STEER_REFUSALS`).

The door reads nothing from the request but `message`. `board` must resolve from the session's own fields, never from the request. `runOf` names the `issue` and `phase` a row's run is keyed by, as the manager keyed its run record, or `undefined` for a row no manager behind the door runs. A task that names no issue is keyed by `taskIssueSegment(row.id)`: its id when the id fits a checkout path and a branch name, and a short hash of it otherwise.

### Answering a worker's message

`harnessTalkTurn({ name?, board, harness, uses?, talkTimeoutMs? })` is the door's talk half as a
block of its own, with the same `board`, `harness`, `uses` and `talkTimeoutMs` as the door. It takes
`{ message }` and answers `{ reply: string | null, taskId }` (`reply` is the harness's final text):
one harness run resumes the coding session of the session's finished task with the message, outside
any attempt, and the task, its output and its attempts don't change. It refuses, failing the request
with `SessionDoorRefused`, with `not-started` (no task ran in this session), `task-running` (the
task or a follow-up is still open) or `cannot-continue` (the harness confirmed no coding session).

A Workforce coding flow passes it as the `turn` of its `messageReceivedEntry`, so a worker's
`sendMessage` to one of its finished tasks (`to: { task: id }`) is answered from the coding session.
The turn's input is a `MessageReceived`, so map it to `{ message }` first:

```ts
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { harnessTalkTurn } from "@flow-state-dev/harness-manager";
import {
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  messageReceivedSchema,
  type MessageReceived,
} from "@flow-state-dev/workforce";

const messageTurn = sequencer({ name: "coder-message-turn", inputSchema: messageReceivedSchema }).step(
  (received: MessageReceived) => ({ message: `Message from ${received.from}, another worker: ${received.text}` }),
  harnessTalkTurn({ name: "coder-message", harness, board }),
);

defineFlow({
  kind: "coder",
  // … actions, task entry and resources as above
  internal: {
    actions: {
      [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
        installation,
        flowKind: "coder",
        hears: "task-sessions",
        turn: messageTurn,
      }),
    },
  },
});
```

The reply is an item in the task's session. Nothing is sent back to the worker that wrote, unless
the coding flow gives its turn a `sendMessage` of its own.

### Stopping a step for a steer

By default a running step finishes first, and the next step takes the steer. Build the manager with `stopsOnAbort: true` when your harness's abort resolves only once its process has exited. The manager then reads its row every `STEER_POLL_MS` (one second) while a step runs, and once the harness has confirmed a coding session to resume, a new message stops the running step, and the next step starts at once with it. The stop ends the step, not the request, and the checkout keeps what the stopped step wrote. A message that arrives before the session is confirmed waits for the step's own end. Leave the option off for a harness whose abort can return while its process still runs.

A step never runs for a task its attempt no longer holds: if the task is cancelled, finishes, or is claimed again while a step runs, the request takes no further step.

A message taken mid-run shows in the run's session as a line from its sender.

### A run that takes a steer live

A harness whose run can take a line mid-turn (Cursor, passed the `onSteerable` feed) offers the manager a way in while a step runs. The manager then reads the task's row every `STEER_POLL_MS` while the step runs, and hands each new message to the running turn as it arrives. The step carries on, with no stop, no new step and no new attempt. A message taken this way shows in the run's session as a line from its sender.

A line the run refuses is not lost. The next step the request runs takes it, as if it had arrived after the step: by default when the step ends, or at once under `stopsOnAbort: true`, which stops the step for it. A line still waiting on the run's answer when the step ends is taken by the next step too, with a note to the agent that it may already have acted on it. Lines owed this way are held in the server's memory for the request, so a server that dies mid-step loses them.

### Upgrading from `messageDoor`

Before `harnessSessionDoor`, a manager's `messageDoor` (and `harnessMessageDoor`) kept a user's line in the `turns/**` collection for the attempt that would act on it. Nothing reads that collection now. If your host ran a version with `messageDoor`, run `upgradeKeptTurns` once at host start, before the first request (Shift Manager's DevTeam host does):

```ts
import { upgradeKeptTurns } from "@flow-state-dev/harness-manager";

const written = await upgradeKeptTurns(runtime.stores, {
  userCell: (userId, orgId) => resolveUserStorageKey(userId, orgId, { id: "coder", isolateUserState: false }),
  ledgers: ["tasks"],
});
```

It writes each kept line no attempt took onto its task as an untaken steer from the user, keyed so a second run adds nothing. A line whose task has finished is left.

## The deadline

`runTimeoutMs` bounds **the harness step**: the manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half and all it promises. How promptly a harness returns after its signal fires is the harness's own business.

Neither bounds what the run *spawned*. A command the agent's process started can outlive the kill; the sandbox you configure on the harness is the fence for that, not this deadline.

## Subscription usage

`harnessUsageAction({ readers, timeoutMs? })` is one flow-level action, the `harnessUsage` query: how much of each coding harness's subscription a user has used, window by window, with how old each reading is. `readers` holds one core `HarnessUsageReader` per harness, keyed by its name. Put it on one flow, the one your screens and workers call:

```ts
import { harnessEnv } from "@flow-state-dev/core";
import { readCodexUsage } from "@flow-state-dev/codex";
import { harnessUsageAction } from "@flow-state-dev/harness-manager";

const env = harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] });
const actions = {
  harnessUsage: harnessUsageAction({ readers: { codex: (options) => readCodexUsage({ env, ...options }) } }),
};
```

- **Input** `{ refresh?: boolean }`. **Output** `{ harnesses: HarnessUsageRow[] }`, sorted by harness: `status` (`windows`, `api-key`, `signed-out`, `unavailable`), `reason`, `plan`, `windows` (each with `checkedAt`, `origin`, `ageMs` and `rolledOver`; `origin` is `"read"` for a reader's refresh and `"run"` for a window a run reported), `checkedAt`, `ageMs` and `refreshError`. No model call.
- **Without `refresh`, nothing is read.** A harness with a reader and no reading yet is listed as `unavailable`, `"Not checked yet"`.
- **`refresh: true` runs the readers**, at most once a minute per user and harness (`USAGE_REFRESH_EVERY_MS`), counted from the last attempt whether or not it worked. Refreshes that arrive together share one call. A reader that throws or outlasts `timeoutMs` (default `USAGE_READ_TIMEOUT_MS`, 10 s) leaves the stored reading and sets `refreshError`.
- **`ageMs` and `rolledOver` are worked out by the server's clock** when the query runs. `rolledOver` is true once a window's `resetsAt` has passed.
- **Run windows land on their own.** Pass the slot's `onUsage` to the harness (`claudeCodeAgent` takes it) and each window a run reports is stored with `origin: "run"`; the session door stores a talk's windows for the user talking. For Claude Code, register `readClaudeUsage` from `@flow-state-dev/claude-code/sdk` as the `claude-code` reader: it names the account and plan, and the windows come from runs.
- **One current record per user and harness.** A reading replaces the last reading's windows and keeps run windows it doesn't name; on a shared window the newer wins. A newer report for a window replaces an older one, and an older one arriving late is ignored, as is a reading older than the stored one. A reading or run window from a different account clears the earlier account's windows and plan. A no-number reading (`api-key`, `signed-out`) clears every window, and a run that started before it doesn't bring them back. The account is kept as a hash; no email is stored. No history.

The record is `harnessUsageCollection` (`HARNESS_USAGE`, `harness-usage/**`, user scope, not client-readable, not writable by a model). On the server, `readHarnessUsage(ctx, now, expected?)` returns the query's rows without refreshing, and `recordHarnessUsage` is the one writer, in two forms: `recordHarnessUsage(ctx, report)` for one window a run reported (the manager's and session door's `onUsage` call it), and `recordHarnessUsage(ctx, harness, reading, checkedAt)` for a whole reading. It answers `"recorded"`, `"kept-stored"` or `"refused-older"`. Both throw when the calling block doesn't have the collection under `HARNESS_USAGE`.

## The export surface, in two halves

**`@flow-state-dev/harness-manager`** is the supported host API, and what this package versions: `harnessManager` and its options, `harnessSessionDoor` and `SessionDoorRefused`, `harnessTalkTurn` with `harnessTalkInputSchema` and `harnessTalkOutputSchema`, `upgradeKeptTurns`, `STEER_POLL_MS`, `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per organization, the run-record collection for building a status surface (a run's questions are on its task's row), and the [usage query](#subscription-usage) with `harnessUsageCollection`, `readHarnessUsage`, `recordHarnessUsage` and their constants and types.

**`@flow-state-dev/harness-manager/checkout`** is how a run gets a directory: `provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the path grammar. `run` and the git timeouts it re-exports come from `@flow-state-dev/workspace`. It is outside the versioned contract, so a host should not import from it. Everything in it is specific to git worktrees. Adopt `harnessManager({ harness })` and let it own the checkout.

The run record's writes (`openRunRow`, `writeRunRow`) aren't exported. Read with `readRunRow` and the collection.

## Telling the guard where you live

`assertDistinctRepository` stops a run being pointed at the repository your own
application lives in, so a coding agent never edits the thing that dispatched
it. It needs to know where that is, and it will not guess:

```ts
assertDistinctRepository("workspace.sourceRepo", sourceRepo, process.cwd());
```

Pass the directory your code lives in. Pass a list if it spans more than one
place. **Pass `[]` if this host has no repository of its own**, such as a built
artifact or compiled output in an image with no `.git` anywhere. That case is
supported; it just has to be said.

There is no default. The guard refuses only on a *match*, so a host it can't
identify would pass unchecked. That is easy to hit with a container whose
`WORKDIR` sits outside the source tree, a service unit, or a process launched
from `/`. Given a location it cannot resolve, it refuses and names the option.

## Limits

- **Saving work across machines is opt-in.** Without a held-work store, a run's checkout exists only on the machine that made it, and a retry that lands elsewhere starts from the base branch. A run whose record says its work was saved, with no store and no live checkout on this machine, asks its owner rather than starting over.
- **A turn in progress can be lost.** Work is saved when a turn ends, so a machine that dies mid-turn loses that turn.
- **A repository on the host's own disk is never saved.** A run cut from a repository listed in `localRepositories` on `localWorkspaceHost` works in that repository directly, and its work stays on that machine.
- **The lease is not a mutex.** Checking the lock and removing it are two steps. A dead holder's lock is reclaimed after a stale window rather than instantly, and the manager refuses a configuration that shortens that window below the longest a live attempt could legitimately hold it. Each acquisition carries its own token, so a displaced process never removes its replacement's lock. The token gives no stronger cross-process exclusion than that.
- **Usage rows are keyed by the bare user id.** Where one user id is reachable from two tenants, both see that user's plan and percents.
- **No retention policy.** Run records grow without bound.
- **A harness that can't resume can't be talked to once finished.** Talk resumes the confirmed coding session, so the door refuses a finished run whose harness never confirmed one (`cannot-continue`).
- **A steer waits for the step to end** unless the run takes it live (Cursor today) or the manager is built with `stopsOnAbort: true`. Claude Code and Codex runs don't take a line mid-turn yet.
- **A steer step needs a confirmed session.** The step a steer adds resumes the coding session the run confirmed. On a run whose harness confirmed none, a steer that arrives after its last step is left on the task untaken: only the `STEER_TURN_ENTRY` turn acts on it, and a host without that entry completes the task over it.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own, with no coding agent and no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Coding agents](https://flow-state.dev/docs/tools/coding-agents) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
