# @flow-state-dev/harness-manager

A task-board worker that turns a row into a **supervised coding run**: its own checkout, a verdict read before the row settles, a question it can ask a person, and the coding agent itself as a slot you fill.

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

Mount it as the block behind a board worker that hands off, and rows filed on that board become supervised runs.

With `workspace: { root, sourceRepo, baseRef }`, every run gets a new branch of `sourceRepo`, cut from `baseRef`. The branch lives in `sourceRepo` itself and the run's checkout sits under `root`.

## Running a project's work

Hand the manager a workspace host instead of a fixed repository, and each run gets its files from whatever the host's source says. A *workspace host* turns a run's source into a directory the agent works in, and saves the files kept with it; a *run source* says where those files come from. Both come from `@flow-state-dev/workspace`:

```ts
import { localWorkspaceHost } from "@flow-state-dev/workspace";

harnessManager({
  boardCollectionId: work.id,
  boardCollection: work,
  workspace: localWorkspaceHost({
    root: "/var/fsd/runs",
    remotes: { allow: ["github.com"] },
    source: (ctx) => ({ kind: "repo", repo: "https://github.com/acme/storefront.git" }),
  }),
  // ...
});
```

For a mailbox board a project holds, `@flow-state-dev/workforce` provides the source: `projectWorkspace({ board: work })` answers with the repository of the project that holds the board's workstream, with the project's files beside the checkout, or the project's files alone when it has none. It reads its collections through `projectWorkspaceCapability`, which goes on the manager's `uses`:

```ts
import { projectWorkspace, projectWorkspaceCapability } from "@flow-state-dev/workforce";

harnessManager({
  // ...
  workspace: localWorkspaceHost({ root, remotes: { allow: ["github.com"] }, source: projectWorkspace({ board: work }) }),
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

## Running a mailbox's board

A mailbox can hold a board (see `@flow-state-dev/workforce` → "Holding a board"). To run its
rows as supervised coding runs, hand the manager that board and its id:

```ts
import { mailboxBoard } from "@flow-state-dev/workforce";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, runOwnerDispatcher } from "@flow-state-dev/harness-manager";

const work = mailboxBoard("eng.feature", "work");

const manager = harnessManager({
  boardCollectionId: work.id,   // "eng.feature.work"
  boardCollection: work,
  // ...the rest as above
});

// On the board that drains the mailbox's rows:
taskBoard({ collection: work, dispatcher: runOwnerDispatcher(), /* ... */ });
```

The manager builds each run's checkout folder and git branch from the board's id, used as is. A
mailbox's board id contains dots, which the manager accepts. It refuses, when you build it, an id
git can't use as a branch name, such as one ending in `.lock`; a mailbox can't name a board
`lock`. Two boards whose ids differ other than in letter case never share a checkout.

The board is kept per organization, so everyone in the organization sees its rows. A row's
coding run belongs to the person who started it: a drain by anyone else in the organization is
refused, naming whose run it is. Their own retry picks up the same checkout, branch and agent
session. With `runOwnerDispatcher()` on the draining board, the refusal happens before the row
is claimed and costs it no attempt. Without it the manager still refuses to run someone else's
row, but only after the claim, so the row is charged an attempt.

**Wire `runOwnerDispatcher()` on every board kept per organization that drains rows into a
manager.** The manager's own refusal keeps the run from being split between two people, but only
the dispatcher keeps a teammate's drain from spending the row's retries. The dispatcher claims in
the board's own readiness and order, so it takes the place of any other dispatcher on that board.

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

A capability claiming one of the manager's own accessors (`runs`, `inbox`, `turns`, the board's ledger) is refused when you build the manager, naming the key.

## Continuing a run

A run that needs a decision writes a question and parks. Answer it, and the next attempt **continues the same coding session** rather than starting over told what was answered.

The recorded session is the one the harness *confirmed* it was in. If the agent has lost that session, the attempt that asked for it ends without one and the next attempt starts fresh.

## Talking to a run

`manager.messageDoor({ drain })` builds a public action a coding flow declares. `drain` names the flow's `internal` entry that runs the drain of the board whose rows the manager works:

```ts
defineFlow({
  kind: "coder",
  internal: { actions: { resume: { block: board.drain } } },
  actions: { message: manager.messageDoor({ drain: "resume" }) },
  task: { actions: { work: { block: manager } } },
});
```

Sent `{ message }` on a run's own session, it writes the message into that session as a user item and keeps it in the manager's `turns` collection. A running attempt stops, and the next attempt resumes the same coding session with the message appended to its prompt, marked as the person's words. The message doesn't count against `maxAttempts`.

The door starts that next attempt by dispatching `drain` into the session that claimed the row, which keeps every attempt in the run's own session. `defineFlow` refuses a flow that doesn't declare the entry. When another flow drains the board and hands rows to this one, declare the entry on that flow and pass that flow's id as `flowKind` (for a flow with one instance, its kind).

It answers `{ outcome: "continuing" | "kept", taskId }`:

- **running** → `continuing`.
- **running, but its harness hasn't named its coding session yet** → held for up to a minute while the attempt starts. `continuing` once the attempt takes the message into its prompt, or names its session (then as **running**). Refused as still starting if it does neither in that time, and as a harness that can't continue if the attempt ends without naming one.
- **running, but it didn't stop within the wait, or the row couldn't be re-queued or drained** → `kept`. The run gets the message from whatever runs the row next.
- **claimed, with its run not started yet** → `kept` for that attempt.
- **parked on its own question, or between attempts** → `kept` for the next attempt; nothing is stopped and the question still needs answering.
- **never started in this session, finished, or on a harness that named no session** → refused. A refusal fails the request, with the reason in words as the error's message and the door's `TurnRefused` error as its cause, so only a delivered message ever completes. A refused message is withdrawn, so no later attempt takes it; if an attempt already took it, the door answers `continuing` instead of refusing.

The door ignores everything in the request except `message`: it works on the task whose run link names the calling session.

## The deadline

`runTimeoutMs` bounds **the harness step**: the manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half and all it promises. How promptly a harness returns after its signal fires is the harness's own business.

Neither bounds what the run *spawned*. A command the agent's process started can outlive the kill; the sandbox you configure on the harness is the fence for that, not this deadline.

## The export surface, in two halves

**`@flow-state-dev/harness-manager`** is the supported host API, and what this package versions: `harnessManager` and its options, `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per organization, and the run-record and inbox collections for building a status surface.

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
- **A harness that can't resume can't take a message.** The door refuses a run whose harness never confirmed a coding session, with *this run's harness can't continue with a message*.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own, with no coding agent and no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Coding agents](https://flow-state.dev/docs/tools/coding-agents) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
