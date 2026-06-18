# @flow-state-dev/dev-orchestrator

A single-issue **dev-loop orchestrator** POC. It babysits one Linear issue and
drives it through the team's workflow — spec → implement → review → done — by
dispatching Claude Code per stage and gating on durable suspensions, pulling a
human in only at genuine decision points.

This is a private dogfooding app (`labs/`), not a published package. It proves
the orchestration loop; the productized surface lives elsewhere.

## What it does

The orchestrator is a **conductor, not a file editor**. It delegates all
spec/code/review work to dispatched Claude Code cloud tasks and detects when
that work has landed by polling Linear and GitHub — never by polling the agent.
Linear's workflow states *are* the state machine:

```
Ready to Spec ─dispatch /create-spec→ In Spec Dev ─(agent)→ In Spec Review
   ─human approval→ Spec Approved ─dispatch /implement-issue→ In Development
   ─(agent)→ In Review ─review↔refine→ (human PR approval) → Done
```

Each stage is a durable sequencer of **single-suspend steps**:

```
seed → (conditionally) dispatch → park until the board advances → human gate → record/transition
```

The driver reads the board each tick, and when a suspension is parked it polls
the matching signal (Linear/GitHub for an agent wait, the human gate for an
approval). When satisfied it acquires the resume lease, marks the suspension
resolved, and re-enters the same request via `continueRequest`. A parked
suspension always wins over the stage machine, so a restart resumes the wait
instead of re-dispatching.

## Current slice

This build implements the **spec stage end-to-end** plus the driver. The
implement and review stages slot in behind the same shape (the stage machine
already routes to them); the driver stops gracefully at their boundary.

## Usage

```bash
# from the repo root
pnpm --filter @flow-state-dev/dev-orchestrator babysit FIX-123
```

Flags:

- `--attended` — prompt for spec/PR approval on stdin instead of polling Linear.
- `--from-backlog` — allow starting the spec stage from `Todo`/`Backlog`.
- `--db <path>` — SQLite durability file (default `.dev-orchestrator/<issue>.sqlite`).

## Environment

- `LINEAR_MCP_API_KEY` — Linear API access for the deterministic status client.
- `claude` on `PATH` — cloud dispatch (`claude --remote`).
- `gh` on `PATH` — GitHub PR / checks signals (implement/review stages).

## Safety bar

The orchestrator auto-advances **forward only** through non-destructive states
(dispatch + transition up to a gate). It **never merges a PR** and **never
crosses a human gate unattended**. Spec approval and PR approval are mandatory
human gates. Destructive operations are outside its authority.

## Notes / deviations

- **Linear client.** The deterministic Linear client is local to this app
  (per the spec's non-goals) and talks to Linear's GraphQL API behind an
  injectable transport seam. The spec floated `@linear/sdk`; the seam keeps that
  a drop-in swap. All orchestration logic above the seam is unit-tested with a
  fake transport; the GraphQL default is verified by a manual smoke run.
- **Single babysit per issue.** A second `babysit` on the same issue fails to
  acquire the resume lease and backs off. Multi-issue concurrency is out of scope.
- **Dispatch idempotency.** Re-dispatch is guarded by checkpoint replay (the
  common restart case), the `skipDispatch` entry flag (entering mid-stage), and
  an in-flight check against persisted `claudeRemoteTasks`. A crash in the narrow
  window between the CLI call and the first checkpoint can still double-dispatch.

## Tests

```bash
pnpm --filter @flow-state-dev/dev-orchestrator test
pnpm --filter @flow-state-dev/dev-orchestrator typecheck
```

The stage machine and signal clients are pure/mocked unit tests; the spec stage
and driver run against the real durable runtime (`runAction` + `continueRequest`
+ in-memory stores), mirroring `packages/server/test/suspension-resume.test.ts`.
No live Claude/Linear/GitHub calls in CI.
