# @flow-state-dev/harness-manager

A task-board worker that turns a row into a **supervised coding run**: its own checkout, a verdict read before the row settles, a question it can ask a person, and the coding agent itself as a slot you fill.

A *harness* is a coding agent driven as a block — you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing the run. This package imports none of them.

## Installation

```bash
pnpm add @flow-state-dev/harness-manager
```

Peer of `@flow-state-dev/core` and `@flow-state-dev/orchestration`. You install a harness separately — `@flow-state-dev/claude-code`, `@flow-state-dev/codex`, `@flow-state-dev/cursor`, or your own.

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

Mount it as the block behind a board seat that hands off, and rows filed on that board become supervised runs.

## Running a channel's board

A channel can hold a board (see `@flow-state-dev/workforce` → "Holding a board"). To run its
rows as supervised coding runs, hand the manager that board and its id:

```ts
import { channelBoard } from "@flow-state-dev/workforce";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessManager, runOwnerDispatcher } from "@flow-state-dev/harness-manager";

const work = channelBoard("eng.feature", "work");

const manager = harnessManager({
  boardCollectionId: work.id,   // "eng.feature.work"
  boardCollection: work,
  // ...the rest as above
});

// On the board that drains the channel's rows:
taskBoard({ collection: work, dispatcher: runOwnerDispatcher(), /* ... */ });
```

The manager builds each run's checkout folder and git branch from the board's id, used as is. A
channel's board id contains dots, which the manager accepts. It refuses, when you build it, an id
git can't use as a branch name, such as one ending in `.lock`; a channel can't name a board
`lock`. Two boards whose ids differ other than in letter case never share a checkout. Board ids
that worked before keep the same folders and branches, so an upgrade moves nobody's work.

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
| `cwd` | Where this run works — the checkout the manager derived and provisioned. |
| `resume` | Which session this attempt continues, or `null` for a fresh one. |
| `onSession` | Called by the harness when it names its session, so the manager records it. |

They are the harness contract's own signatures, declared in `@flow-state-dev/core`. Each is handed the block's context and nothing else — never the run's prompt, because the prompt is something a caller (or a model calling the harness as a tool) sets, and these three decide where a run writes and what it continues.

Everything else about the agent — model, tools, permissions, sandbox — you write inside the factory. Pointing the same manager at another harness is one line, and the manager is unchanged:

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

The vendor options differ because they are the factory's business, not the manager's. `detached: true` is not decoration in the Claude Code example: the harness becomes a child block of a gated task entry, and the claim gate refuses an entry that keeps session state anywhere beneath it. Get it wrong and your flow fails to build, naming the entry. Codex and Cursor keep no session state, so neither needs an equivalent.

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

A capability claiming one of the manager's own accessors (`runs`, `inbox`, `turns`, the board's ledger) is refused when you build the manager, naming the key — silently overriding one of them would send the manager's bookkeeping somewhere nothing reads.

## Continuing a run

A run that needs a decision writes a question and parks. Answer it, and the next attempt **continues the same coding session** rather than starting over told what was answered.

The rule that makes it safe to leave running: the recorded session is the one the harness *confirmed* it was in. `onSession` is its only writer, every attempt clears it first, and the manager never writes back an id it merely sent. So a session the agent has lost is asked for once, and the attempt after that starts fresh.

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

**`@flow-state-dev/harness-manager`** — the supported host API, and what this package versions: `harnessManager` and its options, `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, `runOwnerDispatcher` and `runOwnerOf` for a board kept per organization, and the run-record and inbox collections for building a status surface.

**`@flow-state-dev/harness-manager/checkout`** — how a run gets a directory: `provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the path grammar. A separate entry point rather than a note on the main barrel, because semver binds what the barrel exports whatever a header says about it. This repository's own consumer and its goal checks import from here; a host should not. They are git-worktree-specific, and a second checkout strategy would put them behind a seam. Adopt `harnessManager({ harness })` and let it own the checkout.

The run record's writes (`openRunRow`, `writeRunRow`) and the inbox's `withdrawEarlierQuestions` are on neither: they write through the attempt fence, and calling one from outside a claimed attempt either gets refused or corrupts a ledger the board is the authority on. Read with `readRunRow` and the collections.

## Telling the guard where you live

`assertDistinctRepository` stops a run being pointed at the repository your own
application lives in — a coding agent editing the thing that dispatched it. It
needs to know where that is, and it will not guess:

```ts
assertDistinctRepository("workspace.sourceRepo", sourceRepo, process.cwd());
```

Pass the directory your code lives in. Pass a list if it spans more than one
place. **Pass `[]` if this host genuinely has no repository of its own** — a
built artifact, compiled output in an image with no `.git` anywhere. That case
is real and supported; it just has to be said.

There is no default. A default is a guess, and the wrong guess is silent: this
guard refuses only on a *match*, so a host it cannot identify would match
nothing and pass, leaving the fence off in exactly the deployment shapes
where nobody would notice — a container whose `WORKDIR` sits outside the source
tree, a service unit, a process launched from `/`. Given a location it cannot
resolve, it refuses and names the option.

## Limits

- **One host's storage.** Checkouts and leases live on a local filesystem, so a retry inherits the last attempt's work because that work is on disk. On a multi-host deployment the recorded checkout names nothing on the machine that picks the retry up.
- **The lease is not a mutex.** Checking the lock and removing it are two steps. A dead holder's lock is reclaimed after a stale window rather than instantly, and the manager refuses a configuration that shortens that window below the longest a live attempt could legitimately hold it. The per-acquisition token replaces an inode check so the lease can be written down — it does not buy stronger cross-process exclusion.
- **No retention policy.** Run records and question rows grow without bound.
- **A harness that can't resume can't take a message.** The door refuses a run whose harness never confirmed a coding session, such as `claude-code/cli-remote`.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own — no coding agent, no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Coding agents](https://flow-state.dev/docs/tools/coding-agents) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
