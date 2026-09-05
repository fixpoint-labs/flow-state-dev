# @flow-state-dev/harness-manager

A task-board worker that turns a row into a **supervised coding run**: its own checkout, a verdict read before the row settles, a question it can ask a person, and the coding agent itself as a slot you fill.

A *harness* is a coding agent driven as a block — you hand it a prompt, it works in its own agentic loop, and it hands back a handle describing the run. This package imports none of them.

## Installation

```bash
npm install @flow-state-dev/harness-manager
```

Peer of `@flow-state-dev/core` and `@flow-state-dev/orchestration`. You install a harness separately — `@flow-state-dev/claude-code`, or your own.

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

## The slot

The manager calls your factory once, with three feeds:

| Feed | What it does |
|---|---|
| `cwd` | Where this run works — the checkout the manager derived and provisioned. |
| `resume` | Which session this attempt continues, or `null` for a fresh one. |
| `onSession` | Called by the harness when it names its session, so the manager records it. |

They are the harness contract's own signatures, declared in `@flow-state-dev/core`. Each is handed the block's context and nothing else — never the run's prompt, because the prompt is something a caller (or a model calling the harness as a tool) sets, and these three decide where a run writes and what it continues.

Everything else about the agent — model, tools, permissions, sandbox — you write inside the factory. Pointing the same manager at another harness is one expression:

```ts
  harness: ({ cwd, resume, onSession }) =>
    codexAgent({ cwd, resume, onSession, thread: { sandboxMode: "workspace-write" } }),
```

`detached: true` is not decoration in the Claude Code example: the harness becomes a child block of a gated task entry, and the claim gate refuses an entry that keeps session state anywhere beneath it. Get it wrong and your flow fails to build, naming the entry.

## What a phase supplies

```ts
{
  phase: "implement",
  buildPrompt: (run) => `Implement ${run.issue} in ${run.workspacePath}.`,
  isDone:      (run) => pullRequestExists(run.branch),
  validate:    (workspace) => checkWhateverThisPhaseNeeds(workspace),  // optional
}
```

`buildPrompt` is rebuilt on every attempt from current state. `isDone` is consulted only after a successful verdict — completion is a conjunction, never an alternative route. `validate` runs once at construction and whatever it returns reaches the phase's own hooks, which is how a phase carries something it learned at startup into a run.

Collections a phase reads ride the standard `uses` option:

```ts
harnessManager({ …, uses: [myPhaseCapability] });
```

A capability claiming one of the manager's own accessors (`runs`, `inbox`, the board's ledger) is refused when you build the manager, naming the key — silently overriding one of them would send the manager's bookkeeping somewhere nothing reads.

## Continuing a run

A run that needs a decision writes a question and parks. Answer it, and the next attempt **continues the same coding session** rather than starting over told what was answered.

The rule that makes it safe to leave running: the recorded session is the one the harness *confirmed* it was in. `onSession` is its only writer, every attempt clears it first, and the manager never writes back an id it merely sent. So a session the agent has lost is asked for once, and the attempt after that starts fresh.

## The deadline

`runTimeoutMs` bounds **the harness step**: the manager composes it into the step's abort signal and fires that signal when the deadline passes. That is the manager's half and all it promises. How promptly a harness returns after its signal fires is the harness's own business.

Neither bounds what the run *spawned*. A command the agent's process started can outlive the kill; the sandbox you configure on the harness is the fence for that, not this deadline.

## The export surface, in two halves

**Supported host API** — what you need to stand a manager up, and what this package versions: `harnessManager` and its options, `PhaseSpec` and the run-context types, `WorkspaceConfig`, the construction-time guards (`assertDistinctRepository`, `assertBaseRefExists`, `assertCheckoutRootUsable`, `assertPositiveInt`), `conductorDrainBudgetMs` and `resolveOwnership` for sizing your own shutdown, and the run-record and inbox collections for building a status surface.

**Checkout internals** — `provisionCheckout`, `acquireCheckout`, `branchFor`, `checkoutPathFor` and the path grammar. Exported because this repository's own consumer and its goal checks reach for them, **not** because you should build on them: they are git-worktree-specific, and a second checkout strategy would put them behind a seam. Adopt `harnessManager({ harness })` and let it own the checkout.

## Limits

- **One host's storage.** Checkouts and leases live on a local filesystem, so a retry inherits the last attempt's work because that work is on disk. On a multi-host deployment the recorded checkout names nothing on the machine that picks the retry up.
- **The lease is not a mutex.** Checking the lock and removing it are two steps. A dead holder's lock is reclaimed after a stale window rather than instantly, and the manager refuses a configuration that shortens that window below the longest a live attempt could legitimately hold it. The per-acquisition token replaces an inode check so the lease can be written down — it does not buy stronger cross-process exclusion.
- **No retention policy.** Run records and question rows grow without bound.
- **Git worktrees specifically**, as above.

## Running tests

```bash
pnpm --filter @flow-state-dev/harness-manager test
```

The suite drives the manager with a fake harness the tests own — no coding agent, no network. A source check asserts that nothing in `src/` imports one, which is the property the slot exists for.

## Documentation

[Harness manager](https://flow-state.dev/docs/orchestration/harness-manager) · [Task board](https://flow-state.dev/docs/orchestration/task-board)
