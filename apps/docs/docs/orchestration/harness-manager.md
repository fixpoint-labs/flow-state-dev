---
sidebar_label: Harness manager
---

# Harness manager

A [harness](/docs/tools/coding-agents) is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing what it did. `@flow-state-dev/harness-manager` is a task-board worker that turns a row on a board into a supervised run of one.

Supervised means it does what dispatching a coding agent yourself does not. The run gets **its own checkout**, not whatever directory your server happens to sit in. A **verdict is read before the row settles**, so a run that produced nothing can never close as done. The run can **ask a question** and park until a user answers, and the answer continues the same conversation. And **which harness runs is yours to choose**. The manager imports none of them.

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

**Settle or re-queue.** A run that terminated normally goes on to the phase's completion check, including one that reports `stopped-at-limit`. Pass the check and the row completes. Asked a question, the row parks. Anything else is a failed attempt, re-queued with the reason, until the retry budget runs out.

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

A task from a conversation usually carries a goal and no `issue` or `phase`. The manager then uses the task's id in their place. A task that names only one of the two is refused. A completed run's output carries the agent's last message as `answer` (up to 8,000 characters), the run's `branch`, or `null` when it worked on files alone, and how many `commits` it made.

A run refused before it starts (no project, a remote the host doesn't allow) fails a conversation's task for good, so the conversation hears why; on a fixed board the row is cancelled. A question the run asks parks the task the way the conversation parks any task: the user answers in the conversation, and the run's next attempt gets the answer in its prompt.

You can also give the manager a `judge`: an evaluator block that reads a task's goal, the run's answer and its commits, and says whether the work is done, with a confidence `floor`. It runs after the phase's own check passes, and only for a task from a board read from the claim that has a goal. It answers one of three ways. *Done* closes the task. *Not done* fails the attempt, and the next attempt's prompt carries the judge's reason. *Ask* puts a question to the user, the same way a question from the run does. A verdict below the floor counts as done, and a judge that fails never fails the task: the task settles on the phase's check, and its output says `judged: false`.

To let a user type into a run's session, build the door with `harnessSessionDoor` and tell it which board the calling session's run is on. One door serves every manager on the flow. See [Talking to a run](#talking-to-a-run).

## Choosing the harness

The harness is a slot. You pass a factory; the manager calls it once and hands it three things.

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
  harness: ({ cwd, resume, onSession }) =>
    claudeCodeAgent({ cwd, resume, onSession, detached: true, recordWork: true }),
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

**What the manager hands down.** `cwd` says where this run works: the checkout the manager derived and provisioned. `resume` says which conversation this attempt continues, or `null` for a fresh one. `onSession` is what the harness calls when it names its session, so the manager can record it.

**What the manager never does.** It does not read anything vendor-specific off the handle, and it does not tell the harness what model to use, what tools to allow, or how to sandbox itself. Those are yours, written inside the factory.

The three feeds are declared in `@flow-state-dev/core`. Any block that takes them and returns a conforming run handle is one this manager can drive. [Coding agents](/docs/tools/coding-agents) covers the contract in full.

## What a phase is

A phase is the part that knows what the work *is*: its name, how to build the prompt, and how to tell the job is finished.

```ts
const implementPhase = {
  phase: "implement",
  buildPrompt: (run) =>
    `${run.task.goal}\n\nWork in ${run.workspacePath}, on branch ${run.branch}.`,
  isDone: (run) =>
    run.stopReport === "stopped-at-limit" ? false : pullRequestExists(run.branch),
};
```

`buildPrompt` runs on every attempt, rebuilt from current state rather than computed once when the row was filed. `isDone` answers whether the job is actually finished. It is consulted only *after* a successful verdict, never as another route to completion, so a row completes only when both hold.

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

A run that needs a decision writes its question to a path the prompt names. When the manager sees it, the run parks: the board row waits, nothing is spent while a user thinks, and the question appears wherever your host surfaces it.

Answer it and the run picks up **the same coding session**, not a new one told what was answered. Everything the first attempt had worked out is still there.

**An answer spends a retry.** Parking and resuming is an attempt, so budget for questions as well as failures.

**A lost session doesn't wedge the run.** The manager records only a session the harness *confirmed* it was in. If the agent can no longer find the session an attempt asked to continue, that attempt ends without naming one, and the next attempt starts a fresh session instead of asking for the dead one again.

## Talking to a run

A user talks to a coding run by typing in the run's own session, the one the task's run link names. What a line does depends on whether the task has finished.

**While the task is open, a line steers it.** The line is kept on the task as a message from that user, the same write as `updateTask({ message })` (see [Sending a message to an open task](./task-board.md#sending-a-message-to-an-open-task)). The run takes it at its next step: the same request runs another step that resumes **the same coding session** with the message in its prompt. The checkout and the harness's memory of the conversation carry over, so the run picks up with what it had already read and tried, plus what you said. No attempt is used.

### Steering a run

By default a step that is running finishes first, and the next step takes the message. If your harness's abort resolves only once its process has exited, build the manager with `stopsOnAbort: true`. The manager then checks the task about once a second while a step runs, and a new message stops that step. The next step starts at once, with the message. The stop costs the step the run was in the middle of; the checkout keeps whatever it wrote. Leave `stopsOnAbort` off for a harness whose abort can return while its process still runs, so two processes never work one checkout.

A message that arrives after the run's last step gets one more turn before the task settles, when the flow declares that turn (`STEER_TURN_ENTRY`, below). The first attempt of a task filed with messages already on it carries them all in its prompt.

**Once the task has finished, a line is talk.** One harness run resumes the task's coding session with the line, and its answer is the reply in the session. It runs outside any attempt: the task, its output and its attempts don't change. To change the work, file a follow-up task.

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
| Holds a task that can take no more messages (20) | `steer-refused` |

**A line doesn't spend a retry**, and it isn't an answer: a run waiting on its own question still needs its question answered.

**Only the run's own user can send one.** The session belongs to them, so anyone else is refused before the line is written.

## The checkout

Each task gets its own directory, derived from who the run belongs to plus the board, the issue and the phase. Any later session works out the same path from the same inputs, without looking it up.

The board can be any task collection. A board id with dots in it, like `eng.feature.work`, is accepted as is, and the manager names the folder and branch with it. An id git can't use in a branch name, such as one ending in `.lock`, is refused when the manager is built. Two boards whose ids differ other than in letter case never end up in the same checkout. On a board kept for a whole organization, a row's run belongs to the user who started it, and another user's drain doesn't run it. Give the draining board `runOwnerDispatcher()` and that drain leaves the row untouched, without spending one of its attempts.

A **lease** keeps two attempts out of one tree: a lock file beside the checkout, taken before the tree is provisioned and released on every exit. A process that was displaced never removes its replacement's lock.

The lease is not a mutex. Checking the lock and removing it are two steps, so a lock whose holder has died is reclaimed after a stale window rather than instantly. The manager refuses a configuration that shortens that window below the longest a live attempt can hold the lock.

A checkout lives on the machine that made it, unless you give the manager somewhere to save it. With a workspace host from `@flow-state-dev/workspace` that has a held-work store, and a source that returns a `heldPrefix` for the run (the key prefix its work is stored under), the manager saves the run's commits and uncommitted changes at the end of each turn and when the harness fails. A retry that lands on another machine gets the checkout back from the last save, with the changes unstaged, and the coding agent starts a fresh conversation there. If the saved work doesn't match the run's record, the harness doesn't run: the row parks and the run's owner gets a question naming what disagreed. The run record's `place` and `held` fields show which machine the run is on and what the last save held. The package README's [Running a project's work](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/harness-manager/README.md#running-a-projects-work) has the setup.

## The deadline

`runTimeoutMs` bounds **the harness step**. The manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half, and all it promises.

How promptly the harness then returns is the harness's own business, and harnesses differ. Neither bounds what the run *spawned*: a command the agent's process started can outlive the kill. The sandbox you configure on the harness is the fence for a runaway command, not this deadline.

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

Seeding a row means knowing what your issues are called; a completion check means knowing what "finished" looks like in your world. Neither is something a published package can guess.

## What you import

The package has two entry points, and the difference is what it promises to keep
stable.

`@flow-state-dev/harness-manager` is the supported host API: everything above,
plus the pieces you need around it: `harnessManager` and its options,
`harnessSessionDoor`, `PhaseSpec`
and the run-context types, `WorkspaceConfig`, the construction-time guards
(`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`,
`assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing
your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per
organization, and the run-record and inbox collections for building a status
surface.

`@flow-state-dev/harness-manager/checkout` is how a run gets a directory:
`provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the
path grammar. It is not part of the versioned contract, so don't build a host on
it. Everything in it is specific to git worktrees. Build on `harnessManager({ harness })` and let the manager own the checkout. A
status page or a cleanup job reads `workspacePath` and `branch` off the run
record instead of deriving them again.

## Limits

- **Saving work across machines is opt-in.** Without a held-work store, a run's checkout exists only on the machine that made it, and a retry that lands elsewhere starts from the base branch. A run whose record says its work was saved, with no store and no live checkout on this machine, parks and asks its owner rather than starting over.
- **A turn in progress can be lost.** Work is saved when a turn ends, so a machine that dies mid-turn loses that turn.
- **A repository on the host's own disk is never saved.** A run cut from a repository listed in `localRepositories` on `localWorkspaceHost` works in that repository directly, and its work stays on that machine.
- **No retention policy.** Run records and question rows grow without bound. Fine for a board driving a few tasks; a long-lived one needs pruning, which is not built.
- **A harness that can't resume can't be talked to once finished.** Talk resumes the coding session the run confirmed, so a finished run whose harness never confirmed one is refused (`cannot-continue`). A steer to an open task needs no session: it reaches the run's next step.
- **Git worktrees for a repository.** A run on a repository works in a `git worktree` of it. Where the repository comes from is up to the workspace host you pass as `workspace`; see the package README's "Running a project's work". For a project's work, Workforce's `projectWorkspace` is that source: see [A project's code and files](../workforce/projects.md#coding-work-in-a-project).

## Related pages

- [Task board](./task-board) — the primitive this worker runs on.
- [Work that outlives the turn](/guides/background-work) — how a claimed row reaches a session of its own.
- [Coding agents](../tools/coding-agents) — the harness contract, and the handle the verdict is read from.
- [Claude Code SDK agent](../tools/claude-code-sdk) — one harness, and the `cwd` / `resume` / `onSession` options the slot feeds.
- [Codex SDK agent](../tools/codex) and [Cursor SDK agent](../tools/cursor) — the other harnesses that fit the slot.
