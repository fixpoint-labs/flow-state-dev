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

  // The slot. Called once; the manager hands down three feeds.
  harness: ({ cwd, resume, onSession }) =>
    claudeCodeAgent({ cwd, resume, onSession, detached: true, recordWork: true }),
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

If the saved work doesn't match the run's record, the harness doesn't run. The row's status becomes `parked`, `place.state` is `lost`, and the run's owner gets a question naming what disagreed. Nothing saved is changed or deleted. Once the owner answers, the run starts again from its base, with the saved files in `held/` beside the checkout when they can be read.

Without a held-work store, nothing is saved and the record gets no `place` or `held`. A run whose record says its work was saved, with no live checkout on this machine, parks anyway and asks its owner rather than starting over.

A run its workspace refuses is not retried. That covers a source answering `refused` and a host that won't provision what the source named, such as a remote it doesn't allow. The row is cancelled on its first attempt, before the harness starts, with the refusal as its reason. The same answer would come back on every retry, so retrying would only spend the attempts.

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
id never share a tree. Pass `boardCollectionId` and `boardCollection` too and that board's rows
run exactly as before.

The manager calls `ledgers` on every checked write, not once per run, so keep it cheap. For a
user's line into such a run, declare [`harnessSessionDoor`](#talking-to-a-run) on the flow.

On such a board, a task that names no `issue` or `phase` runs as the manager's phase, with its
task id in their place, and a task naming only one of the two is refused. A task naming both is
feature work in that phase, and its run is keyed by its task id, not by the issue: the board
mints its own task ids, so its id needn't be the one `{ issue, phase }` derives, and two tasks
naming one issue still get a tree each. A fixed board still runs feature rows only, and still
refuses a row whose id isn't the one its payload derives.

A completed run's output carries `answer`, the agent's last message (up to 8,000 characters),
the run's `branch` (`null` for a run with only kept files), how many `commits` it made, and
`judged`. A feature row's output gains the same fields.

On a board read from the claim:

- **A refused run fails the task for good** (`errored`, never retried), so the conversation
  hears why. On a fixed board it is cancelled, as before.
- **A question parks the task on the board**, the way the conversation parks any task. The
  user answers there, and the next attempt gets the answer in its prompt, in the same
  checkout and agent session.
- **A judge, when you give one, reads the run** after the phase's own check passes, for a task
  with a goal. It is your block, typically an evaluator, handed `{ goal, answer, commits: {
  count, subjects } }` and answering `{ verdict: "done" | "not-done" | "ask", confidence,
  reason }`. *Not done* fails the attempt and the next prompt carries the reason; *ask* parks
  the task with the reason as its question. A verdict under `floor` counts as done. `confidence`
  and `floor` run from 0 to 1; a confidence outside that is not a verdict. A judge
  that fails never fails the task: it settles on the phase's check, with `judged: false`. Size
  your shutdown with `harnessDrainBudgetMs({ ..., judge: true })`.

See [Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) for the whole
picture.

## The slot

The manager calls your factory once, with three feeds:

| Feed | What it does |
|---|---|
| `cwd` | Where this run works: the checkout the manager derived and provisioned. |
| `resume` | Which session this attempt continues, or `null` for a fresh one. |
| `onSession` | Called by the harness when it names its session, so the manager records it. |

They are the harness contract's own signatures, declared in `@flow-state-dev/core`. Each is handed the block's context, not the run's prompt.

Everything else about the agent (model, tools, permissions, sandbox) you write inside the factory. Pointing the same manager at another harness is one line, and the manager is unchanged:

```ts
import { codexAgent } from "@flow-state-dev/codex";

harness: ({ cwd, resume, onSession }) =>
  codexAgent({ cwd, resume, onSession, thread: { sandboxMode: "workspace-write" } }),
```

```ts
import { cursorAgent } from "@flow-state-dev/cursor";

harness: ({ cwd, resume, onSession }) =>
  cursorAgent({ cwd, resume, onSession, agent: { model: { id: "composer-2.5" } } }),
```

Any block that takes the three feeds and returns a run handle conforming to `@flow-state-dev/core`'s harness contract is one this manager can drive.

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

A capability claiming one of the manager's own accessors (`runs`, `inbox`, the board's ledger) is refused when you build the manager, naming the key.

## Continuing a run

A run that needs a decision writes a question and parks. Answer it, and the next attempt **continues the same coding session** rather than starting over told what was answered.

The recorded session is the one the harness *confirmed* it was in. If the agent has lost that session, the attempt that asked for it ends without one and the next attempt starts fresh.

## Talking to a run

A user talks to a coding run by typing in the run's own session. `harnessSessionDoor` builds the public action a coding flow declares for that line. One door serves every manager on the flow, and the board the calling session's run is on is resolved per request, from server state:

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

// `harness` is the slot both the manager and the door are given.
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

- **open task** → a steer. The line is kept on the task as a message from the user (`Task.steers`, the same write as `updateTask({ message })`). The run takes it at its next step: the same request runs another step that resumes the coding session the last one confirmed, with the steer in its prompt, on the same attempt. A steer that lands after the run's last step gets one more turn before the task settles, through `STEER_TURN_ENTRY`. Answers `{ steered: <taskId> }`.
- **every task in the chain finished** → talk. One harness run resumes the task's confirmed coding session with the line, outside any attempt, and its answer is the reply. It holds the checkout while it runs, as a run does, so a follow-up claimed meanwhile waits for it; `talkTimeoutMs` (default 10 minutes) bounds it. The task, its output and its attempts don't change. Answers `{ reply, taskId }`.

A refusal fails the request, with the reason in words as the error's message and `SessionDoorRefused` as its cause, so only a delivered line ever completes:

- `not-started`: no task started in this session.
- `cannot-continue`: the task finished and its harness never confirmed a coding session.
- `steer-limit`: the task has taken as many messages as it can (20).
- `finished`: the task finished before the line reached it.
- `not-supported`: the board keeps no messages.

The last three read as they do on Workforce's door (`LINE_STEER_REFUSALS`).

The door reads nothing from the request but `message`. `board` must resolve from the session's own fields, never from the request. `runOf` names the `issue` and `phase` a row's run is keyed by, as the manager keyed its run record, or `undefined` for a row no manager behind the door runs.

### Stopping a step for a steer

By default a running step finishes first, and the next step takes the steer. Build the manager with `stopsOnAbort: true` when your harness's abort resolves only once its process has exited. The manager then reads its row every `STEER_POLL_MS` (one second) while a step runs, and once the harness has confirmed a coding session to resume, a new message stops the running step, and the next step starts at once with it. The stop ends the step, not the request, and the checkout keeps what the stopped step wrote. A message that arrives before the session is confirmed waits for the step's own end. Leave the option off for a harness whose abort can return while its process still runs.

A step never runs for a task its attempt no longer holds: if the task is cancelled, finishes, or is claimed again while a step runs, the request takes no further step.

A message taken mid-run shows in the run's session as a line from its sender.

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

## The export surface, in two halves

**`@flow-state-dev/harness-manager`** is the supported host API, and what this package versions: `harnessManager` and its options, `harnessSessionDoor` and `SessionDoorRefused`, `upgradeKeptTurns`, `STEER_POLL_MS`, `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per organization, and the run-record and inbox collections for building a status surface.

**`@flow-state-dev/harness-manager/checkout`** is how a run gets a directory: `provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the path grammar. `run` and the git timeouts it re-exports come from `@flow-state-dev/workspace`. It is outside the versioned contract, so a host should not import from it. Everything in it is specific to git worktrees. Adopt `harnessManager({ harness })` and let it own the checkout.

The run record's writes (`openRunRow`, `writeRunRow`) and the inbox's `withdrawEarlierQuestions` aren't exported. Read with `readRunRow` and the collections.

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

- **Saving work across machines is opt-in.** Without a held-work store, a run's checkout exists only on the machine that made it, and a retry that lands elsewhere starts from the base branch. A run whose record says its work was saved, with no store and no live checkout on this machine, parks and asks its owner rather than starting over.
- **A turn in progress can be lost.** Work is saved when a turn ends, so a machine that dies mid-turn loses that turn.
- **A repository on the host's own disk is never saved.** A run cut from a repository listed in `localRepositories` on `localWorkspaceHost` works in that repository directly, and its work stays on that machine.
- **The lease is not a mutex.** Checking the lock and removing it are two steps. A dead holder's lock is reclaimed after a stale window rather than instantly, and the manager refuses a configuration that shortens that window below the longest a live attempt could legitimately hold it. Each acquisition carries its own token, so a displaced process never removes its replacement's lock. The token gives no stronger cross-process exclusion than that.
- **No retention policy.** Run records and question rows grow without bound.
- **A harness that can't resume can't be talked to once finished.** Talk resumes the confirmed coding session, so the door refuses a finished run whose harness never confirmed one (`cannot-continue`).
- **A steer waits for the step to end** unless the manager is built with `stopsOnAbort: true`.
- **A steer step needs a confirmed session.** The step a steer adds resumes the coding session the run confirmed. On a run whose harness confirmed none, a steer that arrives after its last step is left on the task untaken: only the `STEER_TURN_ENTRY` turn acts on it, and a host without that entry completes the task over it.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own, with no coding agent and no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Coding agents](https://flow-state.dev/docs/tools/coding-agents) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
