# Orchestration: fleets, epics, and issue lifecycles

This is the **canonical reference** for how we drive Linear issues to merged PRs with
agents — the roles, the artifacts, and the gates. The orchestration skills
(`fsd:issue-fleet`, `fsd:issue-lifecycle`, `fsd:create-spec`, `fsd:implement-issue`,
`fsd:cross-spec-review`) and the worker sub-agents (`issue-worker`, `epic-agent`,
`scout`, `spec-implementer`, `issue-manager`) **reference this doc** instead of each
restating the shared concepts. When a concept here changes, it changes here.

## The pieces at a glance

- **Fleet** — the coordinator. One thin, event-driven session that drives several
  issues in parallel, holds a compact status table, owns subscriptions, and dispatches
  worker sub-agents. Ephemeral (a session). See `fsd:issue-fleet`.
- **Issue lifecycle** — one issue from spec to merge-ready PR, as a state machine
  advanced one bounded step per event. See `fsd:issue-lifecycle`.
- **Epic** *(optional)* — a coordination layer above a *set* of related issues so
  cross-cutting decisions aren't made in a vacuum. Its artifact is the **epic-spec**.
  Owned by the fleet, authored by the `epic-agent`. See "The epic-spec" below.
- **Worker sub-agents** — token-isolated agents the fleet/lifecycle dispatch so heavy
  work happens in *their* context and only a compact summary returns:
  - `issue-worker` (worktree) — advances one issue by one lifecycle step.
  - `epic-agent` (worktree) — authors/maintains one epic-spec.
  - `scout` (Haiku) — read-only status/handle fetches.
  - `spec-implementer` (Sonnet) — implements one decided task.
  - `issue-manager` (Sonnet) — files discovered work into Linear.

```mermaid
flowchart TD
  U([Human]) -->|approves gates| Fleet
  Fleet[Fleet coordinator<br/>thin · event-driven · status table]
  Fleet -->|per issue, worktree| IW[issue-worker]
  Fleet -->|per epic, worktree| EA[epic-agent]
  Fleet -->|status fetches| SC[scout]
  Fleet -->|discovered work| IM[issue-manager]
  IW -->|runs| IL[issue-lifecycle step]
  IL --> CS[create-spec] & II[implement-issue]
  II --> SI[spec-implementer] & RV[review lenses]
  EA -->|reads/writes| ES[(epic-spec<br/>epic/&lt;name&gt; branch<br/>+ Linear project doc)]
```

## The two coordination stores (we keep both — they are not duplicates)

| Store | What it is | Lifetime | Home |
|---|---|---|---|
| **Fleet status table** | The coordinator's **internal working memory** — one row per issue (phase, spec PR#, impl PR#, gate-pending, worktree). Updated constantly. | Session-only | `.orchestration/` (**gitignored — never committed**) |
| **Epic-spec running index** | A **durable, exposed audit log** — links to every issue PR (spec + impl) under the epic, for humans and issue agents to navigate from one place. | Life of the epic | The epic-spec (branch + Linear project doc) |

They overlap in *content* (both know the PR numbers) but differ in *purpose and
audience*: the table is private and ephemeral; the index is public and durable. The
index is refreshed from the table's handles — it is a projection, not a second live
source.

## The epic-spec (canonical artifact)

An **epic-spec** is a coordination artifact for a set of related issues (usually one
Linear project). It exists so decisions aren't made in a vacuum. It is **not** an
implementing spec, and issues do **not** derive from it — they *reference and align* to
it.

**Contents:**

1. **Purpose & objective** — abstract: *why* this body of work, *what outcome*. The
   **holistic necessity check** (the `fsd:create-spec` Step 3.5 lens at epic altitude):
   each issue can earn its place while the whole set overbuilds. This is the gated
   sign-off surface (see Gates).
2. **Themes & long-horizon direction** — cross-cutting decisions above any one issue
   (shared surface, naming, sequencing, shared contracts).
3. **Running index** — the durable audit log of every issue PR under the epic.
4. **Open cross-cutting questions** — raised by review or by issues commenting upward.

**Conventions:**

- **Branch `epic/<name>`**; the doc lives at `docs/specs/_epics/<name>.md` on that branch.
- **Never-merged epic PR** — the reviewable + commentable surface. Stays open for the life
  of the *epic*; closes **unmerged** when the epic wraps.
- **The epic branch is never deleted** (issue spec branches are; the epic branch is not) —
  it stays referenceable.
- **Dual-synced to a Linear *project* document** — same branch + Linear-document pattern
  as issue specs (BP-037), one altitude up (project instead of issue). Discovery is by
  listing the project's documents, **not** by parsing free-text — a project may carry more
  than one epic.
- **Authored/maintained by the `epic-agent`**, dispatched by the fleet. The agent **never
  starts over**: each dispatch it reads the current epic-spec (the doc + PR thread are its
  durable memory) and applies one bounded update. No private `memory:` — the state is the
  visible doc.

## Gates (three native GitHub signals)

Coherence and sign-off run on signals the coordinator can read on any wake, not on
out-of-band chat approval:

| Gate | Signal | Meaning | Blocks |
|---|---|---|---|
| **Build Plan** | spec PR `draft` → ready-for-review | The Case (Part I) holds | authoring Part II (the Build Plan) |
| **Spec approval** | `spec approved` label on the spec PR | The full spec is signed off | implementing that issue |
| **Epic objective** | `epic approved` label on the epic PR | The epic's purpose/outcome is worth pursuing | *ramping* the epic's issues (they hold at NEEDS_SPEC) |

The epic-objective gate is the **only** epic-level gate — the epic's *direction* (themes,
feedback, upward comments) flows continuously and never blocks. The two spec gates are
per issue.

```mermaid
flowchart LR
  subgraph Epic[Epic optional]
    EO{{epic approved?}}
  end
  subgraph Issue[Per issue]
    NS[NEEDS_SPEC] --> CASE[Part I draft PR]
    CASE -->|draft→ready| P2[Part II built]
    P2 -->|spec approved| IMPL[implement]
    IMPL --> FB[PR feedback] --> MERGE([human merges])
  end
  EO -->|approved: release ramp| NS
  EO -.->|pending: hold| NS
```

## How feedback flows (epic ↔ issues)

```mermaid
flowchart TD
  EPR[(Epic PR)] -->|review + human feedback<br/>fanned DOWN by fleet| Issues
  Issues[Issue specs] -->|comment UP<br/>cross-cutting concern, non-blocking| EPR
  Fleet -. owns subscription, routes .-> EPR
```

The fleet owns the epic PR subscription (sub-agents can't hold one) and routes epic
feedback *down* to the aligned issue workers; an issue's `fsd:create-spec` can comment
*up* on the epic PR to raise a cross-cutting concern while it keeps working. All on
existing `subscribe_pr_activity` + PR-comment machinery — no new plumbing.

## Token discipline (why it stays cheap)

Coordinators (fleet, lifecycle) hold only **handles** — issue IDs, PR#s, branches, a few
lines of phase. Every heavy step (author a spec, implement, maintain the epic-spec) runs
in a **worker sub-agent** that does the work in its own context and returns ≤ a screen.
State is re-derived from durable truth (Linear + PRs + the epic-spec doc), never replayed
from transcript. Idle cost ≈ 0.

Event routing follows the same discipline. The coordinator does **not** read event
content: on a PR event it maps PR# → owning issue and dispatches that issue's worker,
which reads the review/CI in its own context. The only content-heavy routing call is
**epic-PR feedback fan-out** ("which aligned issues does this comment touch?") — offload
that *read* to `scout` and route on its answer.

> **Considered and deferred: a dedicated feedback-router sub-agent.** A standing agent that
> triages every incoming event and decides routing was weighed and **not** adopted for v1:
> the coordinator's per-event work is already cheap (PR# → owner → dispatch), content
> reading already lives in the workers, and cross-over signaling already flows via issues
> commenting up on the epic PR. The one genuinely heavy read (epic fan-out targeting) is
> handled by `scout`. Introduce a dedicated router only if event volume and cross-over
> routing outgrow the scout-assisted approach — not preemptively.
