---
sidebar_label: Harness manager
---

# Harness manager

A [harness](/docs/tools/coding-agents) is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing what it did. `@flow-state-dev/harness-manager` is a task-board worker that turns a row on a board into a supervised run of one.

Supervised means it does what dispatching a coding agent yourself does not. The run gets **its own checkout**, not whatever directory your server happens to sit in. A **verdict is read before the row settles**, so a run that produced nothing can never close as done. The run can **ask a question** and park until a person answers, and the answer continues the same conversation. And **which harness runs is yours to choose**. The manager imports none of them.

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
Code needs `detached: true`: it keeps session state by default, and a handed-off
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

A run that needs a decision writes its question to a path the prompt names. When the manager sees it, the run parks: the board row waits, nothing is spent while a person thinks, and the question appears wherever your host surfaces it.

Answer it and the run picks up **the same coding session**, not a new one told what was answered. Everything the first attempt had worked out is still there.

**An answer spends a retry.** Parking and resuming is an attempt, so budget for questions as well as failures.

**A lost session doesn't wedge the run.** The manager records only a session the harness *confirmed* it was in. If the agent can no longer find the session an attempt asked to continue, that attempt ends without naming one, and the next attempt starts a fresh session instead of asking for the dead one again.

## Talking to a run

A person can send a running coding run a message. The run stops where it is, and its next attempt continues **the same coding session** with the message added to its prompt. The checkout and the harness's memory of the conversation both carry over, so the run picks up with what it had already read and tried, plus what you said.

The manager builds the action that does this, which we call its door. Declare it on the flow whose board runs the coding work. The door also needs a way to start the next attempt, so give the flow an `internal` entry that runs the board's drain and pass its name. The door runs that entry in the session that claimed the task, which keeps every attempt of the run in the same session. Internal entries can't be called from outside, so only the door can start the next attempt:

```ts
const manager = harnessManager({ /* … */ });
const board = taskBoard({ /* … the board whose rows the manager works */ });

defineFlow({
  kind: "coder",
  internal: { actions: { resume: { block: board.drain } } },
  actions: { message: manager.messageDoor({ drain: "resume" }) },
  task: { actions: { work: { block: manager } } },
});
```

If the board is drained by a different flow, one that hands its rows to this flow, declare the `resume` entry on that flow instead and pass that flow's id as `flowKind` (for a flow with one instance, its kind): `manager.messageDoor({ drain: "resume", flowKind: "coordinator" })`.

Call `message` with `{ message }` on the run's own session, the one the board row's run link names. The person's words go into that session as a user message the moment the action starts, so a UI can show them as delivered by reading the session, not by trusting the response.

What happens depends on where the task is:

| The task is | Your message |
|---|---|
| Running | Stops the attempt and continues the session with your message. The action answers `continuing` |
| Running, but its harness hasn't opened its coding session yet | Held for up to a minute while the attempt starts. If the attempt picks your message up as it starts, it works on it straight away; if the harness opens its session first, it's handled as Running. Either way the action answers `continuing`. A harness that still hasn't opened one after a minute is refused with *this run is still starting*. If the attempt ends without opening one, the message is refused with *this run's harness can't continue with a message* |
| Running, but it didn't stop in time or couldn't be restarted | Kept, and given to the next attempt. The action answers `kept` |
| About to start an attempt | Kept, and given to that attempt. The action answers `kept` |
| Waiting on its own question, or between attempts | Kept, and given to the next attempt. The action answers `kept` |
| Not started, or finished | Refused, with the reason |

A request that completes answers `{ outcome: "continuing" | "kept", taskId }`.

A refusal fails the request rather than answering with a value, so a request that completed is one whose message landed. The error's message is the reason in words, such as "A finished task takes no message.", and its cause is the door's `TurnRefused` error. A refused message is never handed to a later attempt either.

**A message doesn't spend a retry.** The run parks for your turn and comes back without being charged an attempt, so talking to a run never makes it fail sooner.

**A message isn't an answer.** If the run is waiting on its own question, your message is kept for later but the question still needs answering.

**Only the run's own person can send one.** The session belongs to them, so anyone else is refused before the message is written.

The stop costs the step the run was in the middle of.

## The checkout

Each task gets its own directory, derived from who the run belongs to plus the board, the issue and the phase. Any later session works out the same path from the same inputs, without looking it up.

The board can be your own task collection or one a mailbox holds. A mailbox's board has an id like `eng.feature.work`; the manager accepts it as is and names the folder and branch with it. An id git can't use in a branch name, such as one ending in `.lock`, is refused when the manager is built. Two boards whose ids differ other than in letter case never end up in the same checkout. On a mailbox's board, a row's run belongs to the person who started it, and another person's drain doesn't run it. Give the draining board `runOwnerDispatcher()` and that drain leaves the row untouched, without spending one of its attempts.

A **lease** keeps two attempts out of one tree: a lock file beside the checkout, taken before the tree is provisioned and released on every exit. A process that was displaced never removes its replacement's lock.

The lease is not a mutex. Checking the lock and removing it are two steps, so a lock whose holder has died is reclaimed after a stale window rather than instantly. The manager refuses a configuration that shortens that window below the longest a live attempt can hold the lock.

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
plus the pieces you need around it: `harnessManager` and its options, `PhaseSpec`
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

- **One host's storage.** Checkouts and their leases are on a local filesystem, so a retry inherits the last attempt's work because that work is on disk. On a multi-host deployment the recorded checkout names nothing on the machine that picks the retry up.
- **No retention policy.** Run records and question rows grow without bound. Fine for a board driving a few tasks; a long-lived one needs pruning, which is not built.
- **A harness that can't resume can't be sent a message.** A run whose harness never confirms a coding session is refused with *this run's harness can't continue with a message*.
- **Git worktrees for a repository.** A run on a repository works in a `git worktree` of it. Where the repository comes from is up to the workspace host you pass as `workspace`; see the package README's "Running a project's work". For a mailbox board a project holds, Workforce's `projectWorkspace` is that source: see [A project's code and files](../workforce/projects.md#coding-work-in-a-project).

## Related pages

- [Task board](./task-board) — the primitive this worker runs on.
- [Work that outlives the turn](/guides/background-work) — how a claimed row reaches a session of its own.
- [Coding agents](../tools/coding-agents) — the harness contract, and the handle the verdict is read from.
- [Claude Code SDK agent](../tools/claude-code-sdk) — one harness, and the `cwd` / `resume` / `onSession` options the slot feeds.
- [Codex SDK agent](../tools/codex) and [Cursor SDK agent](../tools/cursor) — the other harnesses that fit the slot.
