# Design — Conductor: the development orchestration system

**Date:** 2026-07-28
**Status:** DEFINITION — project framing and initial approach. **D1 (state ownership) and
D3 (workforce) are decided** (§7); D2 (the public name) stays open until launch.
**Type:** New package (`@flow-state-dev/conductor`) + surfaces (CLI, devtool module).
Composes `core`, `orchestration`, `claude-code`, `engine`, `scheduled`; deliberately
*not* a framework primitive change.
**Supersedes / absorbs:** FIX-832 (single-issue POC, burned), FIX-840 (choreography
reshape — its `state → action` insight is kept and generalized), and is the concrete
first surface under FIX-820 (DevTool as orchestration surface).
**Home:** Linear project *Development Workflow Orchestration*; epic **FIX-966**, milestones
**FIX-967** (M0) → **FIX-971** (M4).

---

## 1. What this is, in plain terms

Conductor is a system that runs a software development process. You give it an
objective and a set of work items; it drives each one from problem through spec,
review, implementation, PR feedback, and retrospective — dispatching the actual coding
work to a coding agent (Claude Code, Codex, or an FSD-native agent), pausing only where
a human decision is genuinely required, and showing you where everything stands.

It is built *on* FSD, and it ships *with* FSD. Any project that uses the framework can
adopt it, configure it, and rewrite its process files. For us it becomes the system we
use to build FSD itself — which makes it the most credible demonstration of the
framework we have.

**This is the dev-orchestrator growing up.** The earlier attempt (§3) was a POC that
served its purpose. The bar here is different and it should be stated plainly: a product
other people would want to use. That bar is what settles most of the design arguments
below — notably that no connector may be a prerequisite (§7/D1) and that the process
files are a configurable, documented surface rather than our prompts with our names in
them.

The process it encodes is not new. It is the process already written down in
[`docs/contributing/orchestration.md`](../../contributing/orchestration.md) and the
`epic-lifecycle` / `issue-lifecycle` / `issue-spec` / `issue-implement` skills. Conductor
does not invent it. Conductor **executes it in code instead of interpreting it in a
prompt.**

## 2. The problem with what we have now

The skills work. The harness running them does not scale.

Today a coordinator agent reads a 278-line state machine written in English and
re-derives, on every wake, what phase each issue is in and what to do next. Everything
else follows from that:

- **The coordinator's context fills up and it loses the thread.** It holds N issues'
  worth of status, gets compacted, and starts forgetting handles.
- **There is no place to look.** Understanding where five issues stand means scrolling
  agent output. The status table is in a transcript, not a view.
- **One conversation, many subjects.** Asking about issue A while the coordinator is
  mid-flight on issue B confuses both.
- **It falls off its tracks.** Phase transitions are prompt-interpreted, so they are
  probabilistic. A deterministic transition should never be probabilistic.
- **One vendor.** The whole thing is Claude Code shaped.

Each of these is a property of the *harness*, not of the process. That is the whole
argument for building this.

### Why not just use Claude Code or Codex

Not "because they're bad at coding" — they are the hands, and conductor calls them.
The claim is narrower and it holds:

| | Agent harness today | Conductor |
|---|---|---|
| Phase transitions | prompt-interpreted, probabilistic | code, deterministic and unit-tested |
| Coordinator state | a transcript that compacts | derived from the world + an append-only ledger |
| Visibility | scroll the output | a queryable board, rendered |
| Concurrency | one context holding N issues | N isolated workers, one operator view |
| Vendor | one | a dispatcher seam; Claude, Codex, or FSD-native |
| Process customization | edit a prompt and hope | edit files against a typed contract |

## 3. Prior art in this repo — read this before starting

**This is the third run at this.** The earlier two are why the design below looks the
way it does, and one of them contains a hard-won lesson we must not pay for again.

- **FIX-820** (Backlog) — *DevTool as a development orchestration surface.* The vision:
  a codebase-aware cockpit that runs the dev loop. Still the right destination.
  Conductor is the engine underneath it; the devtool module is one of its surfaces.
- **FIX-832** (In Development, POC burned) — *drive a single Linear issue through its
  lifecycle.* A durable FSD flow plus a long-lived CLI babysitter. It worked, then
  broke: it carried **two state machines** — the Linear board and the flow's own
  suspend/checkpoint progression — encoding the same progression. They drifted. A
  cold restart between gate 1 and gate 2 looped forever. No code landed in the repo.
- **FIX-840** (Backlog) — *the reshape that diagnosed it.* Conclusion: delete the
  second ledger, make the board the single state machine, express the orchestrator as
  a pure `state → action` map firing discrete idempotent actions, triggered from
  webhook / cron / CLI. That diagnosis is correct and §5 keeps it.

FIX-840's stated rule was "Linear is the single state machine, conductor stores
nothing." That rule is too strong for a product — it makes Linear a hard dependency
and leaves nowhere to put facts Linear cannot hold. §7/D1 sharpens it.

**Related, already done:** `@flow-state-dev/claude-code` CLI dispatch (FIX-672) and
in-process Agent SDK (FIX-671); webhook receivers (FIX-439); same-request
suspend/resume and crash recovery (FIX-811); the `fsdev chat` operator loop (FIX-875).

## 4. The entity model

Refining the initial sketch. Two changes do most of the simplifying work.

**Change 1 — separate phase, gate, and signal.** The sketch's lifecycle list mixed
three kinds of thing. `Drafted`/`Reviewed`/`Approved` are states of a review; `Merge
Conflict` is a condition the world reports. Splitting them makes the driver a pure
function:

- **Phase** — where the work is (`SPEC`, `IMPLEMENTATION`, …).
- **Gate** — what it is waiting on (`awaiting_spec_approval`, `awaiting_merge`).
- **Signal** — what the world just reported (`review_submitted`, `ci_concluded`,
  `merge_conflict`, `base_recovered`, `merged`, `approved`).

**Change 2 — one review cycle, parameterized.** `drafted → in_review → revised →
in_review → approved` is the *same* cycle for a spec, an implementation, an epic-spec,
and a retrospective. `orchestration.md` already states its bar, its three dispositions,
and its two-round budget once, for all of them. So model it once. A "PR" is not an
entity — it is where an **Artifact** happens to be hosted.

```
Objective ──< Epic ──< Issue ──< Artifact ──< Review (round n)
                          │           └──< hostedAt: PR | Linear doc | file
                          ├──< Dispatch (one agent run: vendor, skill, cost, outcome)
                          └──< Lesson
```

| Entity | What it is | Why it exists |
|---|---|---|
| **Project** | the repo conductor drives | scope root: config, connectors, process files |
| **Objective** | a product goal | grounds priority; answers "should this be next?" |
| **Epic** | a set of related issues + their shared direction | cross-cutting decisions need somewhere to live |
| **Issue** | one unit of work; `type` is a routing key | the thing that moves through phases |
| **Artifact** | a reviewable output of a phase | unifies spec review and code review |
| **Review** | one round against an artifact | carries the round count the budget needs |
| **Dispatch** | one agent run | observability and cost; "what actually ran" |
| **Lesson** | a retrospective finding | the input to the self-improving loop |

**Issue `type` is a routing key, not a state machine.** `Feature | Improvement | Bug |
Spike | Prototype | Refactor` selects the discipline (`tdd` vs `diagnose`) and the
review lenses. `issue-implement` already routes this way. Six types, one state machine.

**Phases differ by entity.** Issue: `DISCOVERY? → SPEC → IMPLEMENTATION →
RETROSPECTIVE`. Epic: `FRAMING → CROSS_SPEC_REVIEW → (issues run) → WRAP`. Stating this
explicitly avoids forcing one phase list onto both.

`DISCOVERY` carries a question mark in the sketch and it should stay open — see §9.

## 5. The deterministic spine

One function, no model in the loop:

```ts
plan(entity, world) → Action[]
```

Pure, synchronous, exhaustively unit-testable over the phase × gate × signal matrix.
This is FIX-840's `state → action` map generalized past a single issue. Actions
(`draftSpec`, `reviseSpec`, `recordApproval`, `implement`, `addressFeedback`,
`resolveConflict`, `runGoalCheck`, `retrospect`) are discrete and idempotent — a
duplicate or out-of-order signal is harmless. **Only actions dispatch agents.** The
decision of *what to do next* never involves a generator.

That single property is what kills four of the five pains in §2.

### Gates are derived, not parked runs

A spec-approval gate can stay open for days. Parking a durable run on `ctx.suspend()`
for days means holding a lease across restarts, and FIX-765 (*suspension inside
detached durable execution — no path to surface the approval*, **Todo**) is exactly
that path being missing. So:

- **Long gates** (spec approval, PR approval, merge) are **derived** from world state on
  every tick. Nothing is parked, no lease is held, restart is free. This is FIX-840's
  insight, kept intact — and it means conductor does **not** block on FIX-765.
- **Short in-phase human input** (a question mid-implementation) uses `ctx.suspend()`,
  which FIX-811 made solid.

Approval detection reuses the rules already written in `orchestration.md` → Gates:
latest review per human reviewer, fresh against the current head, bots excluded.

## 6. What we already have (the reason this isn't a multi-month project)

| Conductor needs | Already shipped |
|---|---|
| Fan out N issues, dependency-gated, leased, retried | `taskBoard` (`@flow-state-dev/orchestration`) |
| Per-issue worker isolation | board `workers` registry + assignee routing |
| Short-lived human input gate | `ctx.suspend()` + suspension records (FIX-811) |
| GitHub/Linear events waking the right run | webhook transport, `flow.webhooks` + `sessionId(event)` (FIX-439) |
| Reconcile backstop + new-work discovery | `@flow-state-dev/scheduled` |
| The hands | `@flow-state-dev/claude-code` (`/cli` and `/sdk`) |
| Entity store, project-scoped, local → cloud unchanged | resource collections + `store-sqlite` / `store-postgres` |
| User-editable process files | the skills runtime (`SKILL.md` folders, `agents:` delegation) |
| Live view of activity | SSE item stream + `@flow-state-dev/react` renderers + devtool |
| Operator CLI loop | `fsdev chat` (FIX-875) |
| Proving the real path | the `goals/` harness |
| Vendor #2 | Codex integration, specced (FIX-797) |

**Genuinely new:** the entity/phase model and driver (§4–5), the connector layer
(GitHub, Linear), the board view, and the process-file template. Everything else is
composition — which is the point (tenet 2), and is why a first payoff is weeks not
months.

## 7. Three decisions to make before the first spec

### D1 — Who owns state? **(DECIDED: split by fact owner)**

The sketch says conductor's own resource system is the truth, with hooks to sync
outward. FIX-840 says the board is the only state machine and conductor stores nothing.
These read as opposites; they are not, and the reconciliation is the load-bearing
design call.

FIX-840's bug was never "conductor has state." It was **two authorities for one fact.**
So split by who owns the fact:

- **Derived, never stored** — anything the world owns: PR open/merged, CI conclusion,
  review approval state, head SHA, mergeability, Linear status. Re-read every tick.
  Mirroring any of these into a field we later trust *is* the FIX-832 bug.
- **Stored, because nothing else owns it** — the orchestration ledger: review-round
  counts, gate records with provenance, dispatch history and cost, lessons, objective
  links. Linear has nowhere to put `spec_review_rounds: 2`.

Phase is then derived wherever the world has it and stored only where it doesn't, so
there is exactly one state machine with a mostly-derived state, plus an append-only
ledger. It resolves the conflict, and it is what makes conductor work with **no Linear at
all**.

**Decided, with three consequences that are part of the decision:**

1. **No connector is ever the source of truth, and none is a prerequisite.** Conductor
   runs standalone on its own store. Linear is a *projection* — the same relationship
   `orchestration.md` already draws between the coordinator's status table and the
   epic-spec's running index.
2. **Connector sync is outbound by default, inbound by configuration.** A human moving a
   Linear status can be accepted as an inbound **signal** (§4) that the driver plans
   against — useful, and explicitly opt-in per connector. It is a signal, never a write
   to the ledger, so accepting it cannot re-create the two-authority bug.
3. **The connector layer is an interface, not two integrations.** GitHub and Linear are
   its first two implementations. Adding a third is a v2 question — define the seam now,
   don't build past it (tenet 3).

### D2 — The name **(OPEN — internal name is `conductor`; public name deferred)**

`conductor` fits the metaphor and the pitch ("the harness that conducts your work").
Two cautions: **Netflix Conductor** is a well-known workflow-orchestration engine, which
is a direct collision in this exact category; and `dev-engine` collides with our own
`@flow-state-dev/engine`, which is worse — it would be incoherent inside the repo.
**Recommendation: use `conductor` internally now and treat the public name as an open
question for launch.** The internal name is cheap to change; the package name is less so.

### D3 — Relationship to `workforce` **(DECIDED: bypass, keep the `Dispatcher` seam)**

Conductor's workers are mostly *external* coding agents, not FSD generators with
personas. The right seam is a vendor-neutral `Dispatcher` (given a phase brief plus a
skill, run it, return a typed result), with `claude-code` as the first implementation
and `codex` as the second. `workforce` becomes relevant when we add **FSD-native review
agents** that don't need a full coding harness. **Decided: bypass `workforce` for v1 and
keep the `Dispatcher` seam clean so it drops in later.** Workforce Layer 2 is still in
flight; taking a dependency on it now couples two moving things.

## 8. Initial approach — four milestones, payoff at M1

Sequenced so the first milestone is the one that changes the daily experience.

### M0 — the model, as a pure module (days)

`plan(entity, world) → Action[]`, the entity schemas, the phase/gate/signal types. No
I/O, no agents, no connectors.
**Verify:** unit tests covering the full phase × gate × signal matrix, including the
paths §2 says the current harness drops (restart mid-gate, duplicate signal,
out-of-order signal, backwards phase move).

### M1 — one issue, end to end, driven by code (the payoff)

The tracer bullet: hand conductor one issue; it drives spec → approval gate →
implementation → PR feedback → ready-to-merge. Driver from M0, `claude-code` as the
hands, a read/PR-ops GitHub connector, phases and dispatches emitted as stream items,
a minimal CLI board view.
**Verify:** a real FIX issue reaches a real merge-ready PR with **zero coordinator
model calls**, and the run survives a process restart mid-gate.
This is FIX-832's goal on the substrate that doesn't drift. Pains 1, 2, 4 and the
vendor pain are gone at this point.

### M2 — many issues, under an epic

Fan out via `taskBoard`: one task per issue, per-issue worker isolation, dependency
gating, plus the epic-spec and cross-spec-review phases.
**Verify:** three issues in parallel from one operator conversation, each isolated;
asking about issue A never disturbs issue B. Pain 3 is gone.

### M3 — event-driven, and a surface worth looking at

Webhook transport replaces polling; `scheduled` provides the reconcile backstop and
new-work discovery; the board becomes a devtool module.
**Verify:** a GitHub review event advances the right issue with no session running, and
a cold reconcile re-derives the whole board from the world.

### M4 — connectors, objectives, and the loop that improves itself

Linear sync as a projection, objectives grounding priority, retrospective phase emitting
lessons, and the `distill-lessons` pass proposing the smallest upstream fix to the
process files.
**Verify:** a completed epic produces a lesson that lands as a concrete process-file
change.

**M1 is the fast path.** M0+M1 are the milestone worth committing to; M2–M4 are ordered
but re-decidable once we've lived on M1.

## 9. Out of scope (and open questions)

**Explicitly not in v1:** cloud hosting (local first; the store swap is the only
difference), codebase-awareness / structural index (FIX-820's other half), auto-merge in
any form, replacing Linear as the human-facing board, and general-purpose workflow
orchestration for non-development work.

**Open:**

1. **`DISCOVERY` as a phase.** The sketch flags it with a question mark. A problem
   arriving already articulated needs no discovery phase; a vague one does. Is that a
   phase, or is it a *type* of issue (`Spike`) that happens to produce an issue set?
   Leaning towards the latter — it needs no new machinery.
2. **Retrospective altitude.** Per issue, per epic, or both? `distill-lessons` currently
   runs per-PR *and* periodically. Two altitudes may be right; two implementations are not.
3. **Public name** (D2).
4. **Where the process files live** so they are editable per project but versioned with
   the repo — `.conductor/` alongside `.agents/skills/`, or inside it?

## 10. Immediate next step

**D1 and D3 are called.** The epic and the milestone issues are filed under the
*Development Workflow Orchestration* project. First spec to write: **M0 + M1 as a single
spec**, so the model is validated by a real run rather than by tests alone. Everything
after that is a normal issue under the epic.
