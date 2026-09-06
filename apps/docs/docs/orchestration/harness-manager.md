---
sidebar_label: Harness manager
---

# Harness manager

A [harness](/docs/tools/coding-agents) is a coding agent driven as a block: you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing what it did. `@flow-state-dev/harness-manager` is a task-board worker that turns a row on a board into a supervised run of one.

Supervised means it does what dispatching a coding agent yourself does not. The run gets **its own checkout**, not whatever directory your server happens to sit in. A **verdict is read before the row settles**, so a run that produced nothing can never close as done. The run can **ask a question** and park until a person answers, and the answer continues the same conversation. And **which harness runs is yours to choose** — the manager imports none of them.

```bash
pnpm add @flow-state-dev/harness-manager
```

## What it does

One worker, five steps, and the row settles at the end of them:

```
open the run row  →  build the prompt, take the checkout  →  run the harness
                                                                    ↓
                        settle or re-queue  ←  read the verdict
```

Each step is worth a sentence.

**Open the run row.** The manager keeps its own record of each run, beside the board's. Opening it clears everything the last attempt reported, so a row never mixes two attempts.

**Prompt and checkout.** Your phase builds the prompt (below). The checkout is derived from the task rather than looked up, so a run woken in a session that never saw the last attempt still lands in the same directory. It is held by a lease for as long as the run holds it.

**Run the harness.** Whichever one you handed it. The manager gives it a deadline.

**Read the verdict.** The handle says how the run ended in neutral terms — it finished, it was stopped by a limit, or it failed — and the manager decides from that. It never reads a vendor's own status strings, so two different harnesses settle identically.

**Settle or re-queue.** Succeeded and the job is done, the row completes. Asked a question, the row parks. Anything else is a failed attempt, re-queued with the reason, until the retry budget runs out.

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

Swapping Claude Code for Codex is that one line. Same manager, same board, same
three feeds — it never learns which agent it is driving:

```ts
import { codexAgent } from "@flow-state-dev/codex";

harness: ({ cwd, resume, onSession }) =>
  codexAgent({ cwd, resume, onSession, thread: { sandboxMode: "workspace-write" } }),
```

What the factory passes on differs, because that part belongs to the agent. Claude
Code needs `detached: true` — it keeps session state by default, and a handed-off
row refuses a block that does. Codex keeps none, so it needs no equivalent. Each
spells its sandbox its own way. None of it reaches the manager.

**What the manager hands down.** `cwd` says where this run works — the checkout it derived and provisioned. `resume` says which conversation this attempt continues, or `null` for a fresh one. `onSession` is what the harness calls when it names its session, so the manager can record it.

**What the manager never does.** It does not read anything vendor-specific off the handle, and it does not tell the harness what model to use, what tools to allow, or how to sandbox itself. Those are yours, written inside the factory.

The three feeds are declared in `@flow-state-dev/core`, not here, which is what lets a harness and a manager agree on one spelling. Any block that takes them and returns a conforming run handle is one this manager can drive. [Coding agents](/docs/tools/coding-agents) is the contract in full, including why a resolver is handed the block's context and never the prompt.

## What a phase is

A phase is the part that knows what the work *is*. Three values:

```ts
const implementPhase = {
  phase: "implement",
  buildPrompt: (run) => `Implement ${run.issue} in ${run.workspacePath}.`,
  isDone: (run) => pullRequestExists(run.branch),
};
```

`buildPrompt` runs on every attempt, rebuilt from current state rather than computed once when the row was filed. `isDone` answers whether the job is actually finished — and it is consulted only *after* a successful verdict, never as an alternative route to completion. Both halves have to hold.

If a phase reads collections of its own, ship them as a capability and put it on the manager's `uses`:

```ts
harnessManager({ …, uses: [myPhaseCapability] });
```

The manager installs it on the blocks a phase's hooks run inside, so `ctx.resources` resolves for them like any other block. A capability that claims one of the manager's own accessors is refused when you build the manager, naming the key.

## Asking and being answered

A run that needs a decision writes its question to a path the prompt names. When the manager sees it, the run parks: the board row waits, nothing is spent while a person thinks, and the question appears wherever your host surfaces it.

Answer it and the run picks up **the same coding session** — not a new one told what was answered. Everything the first attempt had worked out is still there.

**An answer spends a retry.** Parking and resuming is an attempt, so budget for questions as well as failures.

**A lost session heals rather than failing.** The manager records the session the harness *confirmed* it was in, clears it at the start of every attempt, and never writes back an id it merely sent. So if the agent can no longer find a session, that attempt ends without naming one, and the next starts fresh instead of asking for a dead conversation forever.

## The checkout

Each task gets its own directory, derived from who the run belongs to plus the board, the issue and the phase. Deriving rather than storing is what lets any later session resolve the same path.

A **lease** keeps two attempts out of one tree: a lock file beside the checkout, taken before the tree is provisioned and released on every exit. It carries a token unique to the acquisition, so a replacement's lock is never removed by a process the replacement displaced.

The lease is not a mutex. Checking the lock and removing it are two steps, not one, so a lock whose holder has died is reclaimed after a stale window rather than instantly. That window is sized past the longest a live attempt could legitimately hold it, which is why the manager refuses a configuration that shortens it below that.

## The deadline

`runTimeoutMs` bounds **the harness step**. The manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half, and all it promises.

How promptly the harness then returns is the harness's own business, and harnesses differ. Neither bounds what the run *spawned*: a command the agent's process started can outlive the kill. The sandbox you configure on the harness is the fence for a runaway command, not this deadline.

## Pointing it away from your own code

A coding agent editing the application that dispatched it is the one accident
worth a guard, so `assertDistinctRepository` refuses a source repository that is
the host's own. It needs to be told where the host lives, and it does not guess:

```ts
assertDistinctRepository("sourceRepo", sourceRepo, process.cwd());
```

Pass the directory your code lives in, a list if it spans several, or `[]` if
this host has no repository of its own — a built artifact in a container, say.
That last case is supported; it just has to be stated.

Given a location it cannot resolve to a repository, it refuses rather than
permits. The reason is that the check only refuses on a *match*: a host it
cannot identify would match nothing and sail through, and the fence would be off
in precisely the deployments where nobody looks.

## What stays with you

The manager runs a claimed row. Everything around that is the host's: putting rows on the board in the first place, waking it, reading status back, and whatever check tells a phase the job is done.

Seeding a row means knowing what your issues are called; a completion check means knowing what "finished" looks like in your world. Neither is something a published package can guess.

## What you import

The package has two entry points, and the difference is what it promises to keep
stable.

`@flow-state-dev/harness-manager` is the supported host API — everything above,
plus the pieces you need around it: `harnessManager` and its options, `PhaseSpec`
and the run-context types, `WorkspaceConfig`, the construction-time guards
(`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`,
`assertPositiveInt`), `harnessDrainBudgetMs` and `resolveOwnership` for sizing
your own shutdown, and the run-record and inbox collections for building a status
surface.

`@flow-state-dev/harness-manager/checkout` is how a run gets a directory:
`provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the
path grammar. Reach for it when you need to resolve or inspect a run's checkout
from outside the manager — a status page that wants the path, a cleanup job. It
is git-worktree-specific, and a second checkout strategy would put it behind a
seam, so build on `harnessManager({ harness })` and let the manager own the
checkout wherever you can.

## Limits

- **One host's storage.** Checkouts and their leases are on a local filesystem, so a retry inherits the last attempt's work because that work is on disk. On a multi-host deployment the recorded checkout names nothing on the machine that picks the retry up.
- **No retention policy.** Run records and question rows grow without bound. Fine for a board driving a few tasks; a long-lived one needs pruning, which is not built.
- **Git worktrees specifically.** The checkout is cut with `git worktree add`. A different strategy — a fresh clone per run, a projected workspace — is not pluggable today.

## Related pages

- [Task board](./task-board) — the primitive this worker runs on.
- [Work that outlives the turn](/guides/background-work) — how a claimed row reaches a session of its own.
- [Coding agents](../tools/coding-agents) — the harness contract, and the handle the verdict is read from.
- [Claude Code SDK agent](../tools/claude-code-sdk) — one harness, and the `cwd` / `resume` / `onSession` options the slot feeds.
- [Codex SDK agent](../tools/codex) — the other one.
