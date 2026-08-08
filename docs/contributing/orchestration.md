# Orchestration: epic and issue lifecycles

This is the **canonical reference** for how we drive Linear issues to merged PRs with
agents — the roles, the artifacts, and the gates. The orchestration skills
(`epic-lifecycle`, `issue-lifecycle`, `issue-spec`, `issue-implement`,
`cross-spec-review`, `spec-poc`, `settle-claim`) and the worker sub-agents (`issue-worker`,
`epic-agent`, `poc-agent`, `scout`, `spec-implementer`, `issue-manager`) **reference this doc**
instead of each restating the shared concepts. When a concept here changes, it changes here.

Two companion docs sit beside this one.
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) is canonical for what a PR description
owes its two audiences — the static reviewer contract, and the per-PR *"Parts worth reviewing
closely"* block. Every PR we open carries both.
[`asking-for-decisions.md`](asking-for-decisions.md) is canonical for what an **ask** contains
— the engineer/product-owner contract and the six-part shape. Every gate, every escalated
blocker, and every fork put to the user is written to it.

## The pieces at a glance

There are exactly **two lifecycles**, one per altitude: an issue has a lifecycle, and a
set of related issues has one too. Nothing coordinates a *bag* of unrelated issues —
parallelism is a property of an epic, not a mode of its own.

- **Epic lifecycle** — the coordinator. One thin, event-driven session that drives an
  **epic** and the issues under it in parallel, holds a compact status table, owns
  subscriptions, and dispatches worker sub-agents. Ephemeral (a session). See
  `epic-lifecycle`.
- **Issue lifecycle** — one issue from spec to merge-ready PR, as a state machine
  advanced one bounded step per event. See `issue-lifecycle`.
- **Epic** — the coordination layer above a *set* of related issues, so cross-cutting
  decisions aren't made in a vacuum. An epic is a **Linear parent issue
  with the `Epic` label (Kind group)**; the work items are its **sub-issues**. Its artifact is the
  **epic-spec** (attached to the epic issue, exactly as a spec attaches to a work issue).
  Owned by the epic lifecycle, authored by the `epic-agent`. **Running several issues in
  parallel always happens under an epic** — that's what makes them a set rather than a
  batch, and it's what gives their shared decisions somewhere to live. A single issue on
  its own needs no epic (`issue-lifecycle` runs standalone). See "The epic-spec" below.
- **Worker sub-agents** — token-isolated agents the coordinator/lifecycle dispatch so heavy
  work happens in *their* context and only a compact summary returns:
  - `issue-worker` (worktree) — advances one issue by one lifecycle step.
  - `epic-agent` (worktree) — authors/maintains one epic-spec.
  - `poc-agent` (worktree, Sonnet) — settles one disputed factual claim with a throwaway POC.
  - `scout` (Haiku) — read-only status/handle fetches.
  - `spec-implementer` (Sonnet) — implements one decided task.
  - `issue-manager` (Sonnet) — files discovered work into Linear.
- **Workflow scripts** — the parts of a lifecycle that are pure mechanism, as deterministic
  control flow instead of prose a coordinator re-derives each wake. Both live in
  `.agents/workflows/` and share one verification harness (`node .agents/workflows/verify.mjs`,
  stubbed hooks, no agents spawned):
  - `epic-wake` — one epic-lifecycle wake: the objective gate, per-issue refresh, the capped
    worker fan-out, the review budgets, claim dedupe, verdict routing.
  - `issue-multi-pr` — one step of a multi-PR issue's DAG: ready set, base selection, rebase
    after a dependency merges, and the assembled end-to-end goal.

  **A script cannot wait, prompt, subscribe, or touch the filesystem.** So every *gate*, every
  PR subscription, the `.orchestration/` store, and turn-ending stay with the coordinator; the
  scripts get state via `args` and return it. That boundary is what decides which half of a
  lifecycle is prose and which half is code — see `epic-lifecycle` → "Each wake is a workflow".

### The workflow-script contract

A workflow script is **not a standalone ES module** and will not run under `node`. Claude Code's
**Workflow tool** executes it: the harness hoists `export const meta` out, wraps the body in an
async function (so a top-level `return` is the script's result), and injects its API as globals.
That's why these files have no imports and why their top-level `return` is legal.

| Injected | What it does |
|---|---|
| `agent(prompt, opts)` | Spawn a sub-agent. With `opts.schema` (JSON Schema) it returns the validated object; without one, the agent's final text. `null` if the agent dies or is skipped. `opts`: `label` · `phase` · `schema` · `agentType` · `model` · `effort` · `isolation: 'worktree'`. |
| `parallel(thunks)` | Barrier — awaits all. A thunk that throws resolves to `null` and the call **never rejects**, so filter before use. |
| `pipeline(items, ...stages)` | Each item runs every stage independently, no barrier between stages. A throwing stage drops that item to `null`. |
| `log(msg)` / `phase(title)` | Progress output. Every `phase()` title must appear in `meta.phases`. |
| `args` / `budget` / `workflow()` | The tool's `args` verbatim; the turn's token target; run another workflow inline (one level only). |

Hard limits worth knowing before writing one: **no filesystem, no imports, no `Date.now()` /
`Math.random()`** (they'd break resume), concurrency capped at `min(16, cores − 2)`, and plain
JS — no TypeScript syntax.

**`.agents/workflows/verify.mjs` is this contract's local mirror.** It reproduces the hook
semantics with stubs so the scripts' decisions are testable without spawning agents. Its
passing tests prove the scripts behave correctly *against that mirror*; they do not prove the
mirror matches the harness. If harness behavior ever surprises you, fix `verify.mjs` first —
it is the thing that encodes our understanding of the contract.

```mermaid
flowchart TD
  U([Human]) -->|approves gates| Coord
  Coord[Epic lifecycle coordinator<br/>thin · event-driven · status table]
  Coord -->|per issue, worktree| IW[issue-worker]
  Coord -->|per epic, worktree| EA[epic-agent]
  Coord -->|disputed claim, worktree| PA[poc-agent]
  Coord -->|status fetches| SC[scout]
  Coord -->|discovered work| IM[issue-manager]
  IW -->|runs| IL[issue-lifecycle step]
  IL --> CS[issue-spec] & II[issue-implement]
  II --> SI[spec-implementer] & RV[review lenses]
  EA -->|reads/writes| ES[(epic-spec<br/>epic/&lt;name&gt; branch + epic PR<br/>+ Linear Epic issue doc)]
  EPIC[[Linear Epic issue · Kind: Epic]] -.->|parent of| ISS[work issues = sub-issues]
  EA -->|creates / attaches spec| EPIC
```

## The two coordination stores (we keep both — they are not duplicates)

| Store | What it is | Lifetime | Home |
|---|---|---|---|
| **Coordinator status table** | The coordinator's **internal working memory** — one row per issue (phase, spec PR#, impl PR#, gate-pending, worktree). Updated constantly. | Session-only | `.orchestration/` (**gitignored — never committed**) |
| **Epic-spec running index** | A **durable, exposed audit log** — links to every issue PR (spec + impl) under the epic, for humans and issue agents to navigate from one place. | Life of the epic | The epic-spec (branch + Linear Epic-issue doc) |

They overlap in *content* (both know the PR numbers) but differ in *purpose and
audience*: the table is private and ephemeral; the index is public and durable. The
index is refreshed from the table's handles — it is a projection, not a second live
source.

## Worktree branching (base every issue branch on fresh `origin/main`)

A worktree worker (`issue-worker`, `epic-agent`, or any `isolation: worktree` sub-agent)
does **not** start from a clean checkout of the default branch. The harness spins its
worktree off the **coordinator session's current checkout** — the lifecycle branch.
That branch drifts behind `main` as sibling PRs merge, and it carries coordinator-only
state (the `.orchestration/` working memory is gitignored, but the branch HEAD is still
whatever the coordinator sat on). Building an issue branch straight on top of that inherits
stale code and, if the coordinator branch ever diverges, puts unrelated commits under the
issue's PR.

So **every issue branch is (re)based on freshly-fetched `origin/main` at creation**, not on
the branch the worktree was spun off. Use the worktree-safe form:

```bash
git fetch origin main
git checkout -B <branch> origin/main        # e.g. spec/<ISSUE-ID> or fix/<ISSUE-ID>
```

- **Never `git checkout main`.** The shared `main` ref can be checked out in only one
  worktree at a time, so parallel workers racing on it collide
  (`fatal: 'main' is already checked out at ...`). `checkout -B <branch> origin/main`
  bases off the remote-tracking ref without ever occupying `main`, so any number of
  workers can run it at once.
- **Only at branch *creation*.** `-B` resets the branch to `origin/main`, discarding any
  commits already on it — so run it only when first authoring the spec or first
  implementing. On **re-entry** to an existing branch (a spec-review round, a PR-feedback
  round — each a fresh worktree under the coordinator), *fetch and check out the existing branch*
  instead: `git fetch origin <branch> && git checkout -B <branch> origin/<branch>`. Each
  spec-review round runs in a fresh worktree, so this is the normal path for a
  spec-review round, not an edge case. The
  skills' re-entry guards (an in-flight impl PR jumps straight to PR-feedback) keep these
  paths apart.
- **Exception — a dependent sub-PR** bases on its dependency's branch, not `main`, so review
  can start before the dep merges: `git fetch origin <dep branch> && git checkout -B <sub-PR
  branch> origin/<dep branch>` (rebase onto the dep when it merges). See `issue-lifecycle` →
  Multi-PR issues.

This lives here so `issue-spec` and `issue-implement` share one guarantee rather than each
half-solving it.

## The epic-spec (canonical artifact)

An **epic-spec** is a coordination artifact for a set of related issues. It exists so
decisions aren't made in a vacuum. It is **not** an implementing spec, and issues do
**not** derive from it — they *reference and align* to it.

**Every multi-issue run has one.** An epic is what makes a set of issues a set: it names
the outcome they share and gives their cross-cutting decisions somewhere to live. So
`epic-lifecycle` does not run without an epic — if the issues someone hands it have no
shared outcome worth writing down, they aren't a set, and they should run as independent
`issue-lifecycle` sessions instead. (Reject the batch; don't invent an epic to wrap it.)

The epic itself is a **Linear parent issue tagged with the `Epic` label (Kind group)**, and
the work items are its **sub-issues**. That makes Linear the durable state manager for the
whole set — one query on the epic issue returns its state plus every sub-issue's state — and
makes discovery native: a work issue's epic is simply its **parent** (no registry to parse).
The `Epic` label lets humans filter epic issues off the working board (they're containers,
not work), and forces the set to crystallize *what it's trying to achieve*. The coordinator
creates the epic issue and parents the set's issues under it (via the `epic-agent`;
`issue-manager` conventions for relations apply). **Re-parenting respects Linear's
one-parent rule** — an issue that already has a functional parent is linked with
`relates-to` and flagged, never silently detached.

**Contents and shape:
[`epic-spec-template.md`](epic-spec-template.md)** — the five sections (purpose &
objective · themes & long-horizon direction · shape of the whole · running index · open
cross-cutting questions), each with a worked example, plus the reviewer guidance the epic PR
description leads with. Read the template; it is the single source of truth for what
each section owes its reader, exactly as `spec-template.md` is for an issue spec.

**Conventions:**

- **Branch `epic/<name>`**; the doc lives at `spec/_epics/<name>.md` on that branch.
- **Never-merged epic PR** — the reviewable + commentable surface. Stays open for the life
  of the *epic*; closes **unmerged** when the epic wraps.
- **The epic branch is never deleted** (issue spec branches are; the epic branch is not) —
  it stays referenceable.
- **Dual-synced to the Linear *Epic issue's* document** — same branch + Linear-document
  pattern as issue specs (BP-037), one altitude up: the epic-spec attaches to the epic
  issue exactly as a spec attaches to a work issue. **Discovery is native** — a work issue's
  epic is its **parent** (check `issue.parent`; does it carry the `Epic` Kind label?). No registry, no
  free-text parsing.
- **Authored/maintained by the `epic-agent`**, dispatched by the coordinator. The agent
  **never starts over**: each dispatch it reads the current epic-spec (the doc + PR thread
  are its durable memory) and applies one bounded update. No private `memory:` — the state
  is the visible doc.
- **Reviewed at the same altitude as an issue spec** — the epic-spec is a *direction*
  artifact, so "Spec review: the bar and the convergence rule" below governs its PR too.
  Feedback that doesn't change the epic's objective or a cross-cutting decision belongs to
  the issues under it, not to the epic-spec.

## Which issues get a spec (the two routes)

Not every issue is specced. There are **two routes into implementation**, and an issue's
route decides whether it has a spec-approval gate at all.

| Route | Taken by | Artifact before code | Gate before code |
|---|---|---|---|
| **Spec route** (default) | Feature · Enhancement · Improvement — anything whose *approach* is a decision | A spec (`spec-template.md`), reviewed as its own PR | Spec approval |
| **Direct route** | **Bug** | None. The Linear issue is the contract | **None** — the implementation PR is where the fix is reviewed |

**Why a bug skips it.** The hard part of a bug is the *diagnosis*, and diagnosis happens
in code — `diagnose` builds a feedback loop and reproduces the failure before anything is
changed. A spec written before that loop exists is a guess at a cause nobody has
confirmed; a spec written after it describes a fix that is already understood. Either way
it's a document round-trip that buys no decision, in front of a change that is usually
small and local. So the fix goes straight to a PR and gets reviewed where it can actually
be judged: against the diff, next to the regression test that proves it.

**The trade, stated plainly.** A bug's first human look is the diff, so a wrong approach
costs a code review instead of a doc edit. That's acceptable *because* bug fixes are
small and localized — and the escape hatches below are what keep the ones that aren't out
of this route.

**Three things send a bug back to the spec route. Who decides each is part of the rule** —
they become visible at different moments, so a reader who sees only one list will think the
others are missing:

1. **A spec PR already exists** — *the router decides.* Someone specced it deliberately;
   honour that rather than stranding a reviewed document and implementing past its live
   approval gate. Re-derived on every refresh. **The worker re-checks it too**, with one
   cheap `gh pr list`, because a row discovered mid-wake was never PR-scanned: its spec
   handle is *unknown*, not known-absent, and the worker is the thing that would otherwise
   write the code.
2. **No reproduction, or an ambiguous symptom** — *the worker decides,* before it builds.
   There's nothing to diagnose against, so working out *what is even happening* is real
   research. The spec for a bug is worth writing then, and what it carries is the
   reproduction shape and the regression seam.
3. **It isn't really a bug** — *the worker decides,* before it builds. The "fix" is a new
   capability, or it changes a contract other code depends on. Promote it — a feature must
   not reach `main` through the one route with no gate in front of it. A *routing* call,
   not a reaction to the fix turning out to be interesting.

**Relabelling after the fix is built does not re-gate it.** A bug relabelled Feature while
its PR is open re-routes to `spec`, but no spec is written and no approval is demanded: the
code exists and is under review, so a spec after the fact settles nothing the PR review
doesn't. What the row must not do is get pulled into the **cross-spec coherence pass** as a
member with no spec document — it is excluded there for the same reason a bug is.

**Mid-diagnosis, a design decision does *not* send it back.** Once the repro exists and
the cause is understood, a fix that turns on a judgment call — two defensible places to
put the guard, a behavior change users could notice — is **implemented on best judgment
and surfaced on the PR**, with the alternative named. It does not stall waiting for an
answer and it does not detour into a spec. That is the whole point of "debate the fix in
the implementation PR": the reviewer is looking at the real code, which is a better place
to settle it than a document would have been. Escalate instead of deciding only when the
choice is genuinely not the implementer's to make (it reverses a shipped contract, or it
is the epic's to settle) — the ordinary blocker path, not a route change.

**The route is derived, never stored as an opinion.** It comes from the Linear category
label on every refresh, so relabelling an issue re-routes it. When the category can't be
read, the route defaults to **spec** — failing closed keeps the gate, and the cost of
being wrong in that direction is one unnecessary document rather than ungated code.

## Gates (three native GitHub signals)

Coherence and sign-off run on signals the coordinator can read on any wake, not on
out-of-band chat approval:

| Gate | Signal | Meaning | Blocks |
|---|---|---|---|
| **Spec approval** | an approving comment or GitHub Review from a human on the spec PR | The full spec (Part I + Part II) is directionally signed off | implementing that issue |
| **Epic objective** | an approving comment or GitHub Review from a human on the epic PR | The epic's purpose/outcome is worth pursuing | *ramping* the epic's issues (they hold before their first action) |

The epic-objective gate is the **only** epic-level gate — the epic's *direction* (themes,
feedback, upward comments) flows continuously and never blocks. The spec-approval gate is
per issue, and **only spec-route issues have one**: a bug has no spec PR, so its single
human gate is the merge (see "Which issues get a spec"). The epic-objective gate still
holds it — a bug under an unapproved epic waits like everything else, it just waits at
implementation instead of at spec.

**Both gates sign off a *direction*, not a finished design.** What each gate does and does
not certify is the subject of the next section; read it before treating an open review
thread as something that has to be closed before a gate can pass.

**Both are asked of a product owner, so both are written as business decisions.** A gate
surfaced as *"the spec PR is open, please approve"* pushes the whole framing job onto the
person least equipped to do it — they have to open the document, find the direction, and work
out what approving costs. Surface instead what they are signing off in their own terms: the
outcome it buys, the calls that are hard to reverse, your recommendation, and what they might
know that would change it. [`asking-for-decisions.md`](asking-for-decisions.md) is the shape;
the lifecycles apply it when they surface a gate, and the same rule governs an **escalated
blocker** — a worker that can't settle a fork returns the parts of the ask, and the
coordinator (which never read the code) surfaces them without re-deriving.

**Why a comment or review, not a label — either drives; label and Linear mirror.** A
`labeled` webhook is **not** in the PR-activity stream the coordinator subscribes to
(comments, CI, and reviews are), so a label a human applies never wakes the session —
it's only noticed on the next heartbeat poll. A **comment or a review submission is
delivered**, so either wakes the coordinator immediately. The two sign-off gates
therefore run on **either an approving comment or an approving GitHub Review from a
human**, and the coordinator **mirrors it to the `spec approved` / `epic approved`
label** — a durable, filterable record — the moment it detects one. The label is
written by the coordinator now, not applied by the human; it records the gate, it no
longer triggers it.

**What counts as approval.** Either signal, from a human:

- **A comment** that (a) expresses approval — its body says "approved" — **and** (b) is
  authored by a human: not a bot account, and not a comment whose body marks it as
  bot-written (the `_Generated by …_` attribution footer, a "written by &lt;bot&gt;"
  line).
- **A GitHub Review** whose **current effective state is `APPROVED`**, authored by a human
  — same bot exclusion as the comment path — **and** whose author is not the PR's own author.
  GitHub already refuses to let a PR author submit an "Approve" review on their own PR, so a
  native review approval is inherently a second person's sign-off; the coordinator checks
  `review.user != pr.user` explicitly anyway rather than depending on that alone. This matters
  in practice: automated review bots (Cursor Bugbot, Codex, and similar) post Review
  submissions with a `state`, not just comments, and none of them should trip this gate.

  **Latest-state, not any-state — the reviews list is chronological history.** The reviews
  endpoint returns *every* review ever submitted, so a lone `state: APPROVED` in it does **not**
  mean the PR is approved *now*. Collapse to the **latest review per human reviewer** and gate
  on that: an approval counts only if that reviewer's most-recent review is `APPROVED`, and
  **no** human reviewer's latest review is `CHANGES_REQUESTED` (a later change-request overrides
  an earlier approval; a later approval clears an earlier change-request). Otherwise a reviewer
  who approved and then requested changes would still trip the gate on the stale approval.

  **Fresh against the current head.** Each review carries a `commit_id`. An approval on an
  earlier commit is **stale** once the author pushes new work — implementation must not start
  from an unreviewed head. Require the approving review's `commit_id` to be the PR's current
  head SHA (or, equivalently, treat any substantive push after an approval as re-opening the
  gate). Because the coordinator re-derives gate state every wake (it never treats a
  once-seen approval as permanent — see the subscription/refresh discipline), a post-approval
  push naturally drops the gate back to pending on the next refresh; the rule here is just that
  the check is "is the *current head* approved," not "was anything ever approved."

Both clauses are load-bearing — they exclude the coordinator's own footer-signed
comments and every review bot, so only a genuine human sign-off — by comment or by
review — trips the gate. **A substantive push after a comment-based approval re-opens the
gate too** (the comment carries no `commit_id`, so the coordinator treats a human "approved"
as approving the state at that moment; new work needs fresh sign-off).

The epic *issue's* Linear state is a second human-facing mirror of the objective gate, not
the trigger — the **coordinator writes that mirror** when the approving comment or review
lands, so it doesn't drift. (The epic issue itself is tagged with the **`Epic` label under Linear's
"Kind" group** — that's what marks a Linear issue as an epic and keeps it filterable off the
working board.)

```mermaid
flowchart LR
  subgraph Epic[Epic]
    EO{{epic approved?}}
  end
  subgraph Issue[Per issue]
    RT{category?}
    RT -->|feature/enhancement| NS[NEEDS_SPEC] --> SPEC[spec PR: Case + Build Plan]
    SPEC -->|spec approved| IMPL[implement]
    RT -->|bug: no spec| IMPL
    IMPL --> FB[PR feedback] --> MERGE([human merges])
  end
  EO -->|approved: release ramp| RT
  EO -.->|pending: hold| RT
```

For a **single-PR** issue the goal is proven at implementation completion (before the PR opens),
so `merge` is completion. For a **multi-PR** issue (a spec's PR plan), the diagram's single
`merge → done` expands: the per-sub-PR runs only prove their slices, so **after the last sub-PR
merges the assembled end-to-end goal runs, and only its PASS marks the issue done** — the last
merge is not itself completion. See `issue-lifecycle` → Multi-PR issues for the exact step.

## Spec review: the bar and the convergence rule

A spec PR exists to answer **one** question: *is this the right approach?* It is a
direction check, not a design review — the whole point of reviewing a spec is that a
wrong approach costs a doc edit here and a rewrite later. This section is the canonical
statement of the bar and how a spec-review round terminates; `issue-spec`,
`issue-lifecycle`, `epic-lifecycle`, and `issue-implement` all reference it.

### What sign-off certifies

**Directional correctness, and nothing more.** An approved spec means: the problem is
real, the approach will work, the decisions in Part I are the ones we want, and the build
plan's shape and sequence are sound. It does **not** mean the design is finished, the
names are final, or every question a reader could raise has been answered. Part II is
*directional by construction* (see `spec-template.md`) — the implementer settles
signatures, local structure, and line-level choices in the code, under `tdd`/`diagnose`
and the challenger.

So a spec is done when it is **directionally correct**, not when it is unimpeachable.
"Nothing left to nitpick" is not the bar and was never reachable — it's an infinite
target, and chasing it is how a design that was right on round one takes ten rounds to
get approved.

### The bar — one test, three dispositions

For each piece of review feedback, ask the **only** question that matters at this
altitude: *does acting on this change the approach?* Then pick exactly one disposition:

| Disposition | When | What happens |
|---|---|---|
| **Fold in** — spec-level | The approach is wrong, won't work, or solves the wrong problem · a Part I Decision is wrong or missing · a constraint the design didn't account for invalidates it · scope is wrong (a deliverable that shouldn't ship, or a missing one) · the spec contradicts itself | Re-draft the affected sections (anti-addenda rule), mirror repo doc ↔ Linear, reply on the thread |
| **Note for the implementer** *(the default)* | Anything below that line: naming, file layout, local structure, which helper, error-message wording, a micro-optimization, a test-name preference, "have you considered X *here*", a detail Part II deliberately left open | Record **verbatim** under the spec's *Review notes for the implementer* section, reply once saying it's left for implementation, move on. **Do not rewrite the design prose around it.** |
| **Drop, specifically for the solution sketch** | A spec may carry rough illustrative code showing the *shape* of the proposed solution (`spec-template.md` §7). Feedback that it lacks error handling, has loose types, misses edge cases, misnames things, or wouldn't compile | Reply once: the sketch is illustrative and deliberately incomplete. **Never** fold, and don't even carry it as a §13 note — a note implies the implementer should weigh it, and there is nothing to weigh about code that isn't shipping. Only feedback on the sketch's *direction* (wrong layer, wrong composition, won't work at all) is real, and that is ordinary **Fold in** |
| **Drop** | Already answered in the spec · out of the issue's scope · a preference with no defect behind it · a factual error about the codebase | Reply once with the pointer or the correction. No spec edit, no note. |

**The default disposition is Note, and the burden of proof is on folding.** If you can't
name which Part I Decision or which part of the approach changes, it is not spec-level —
it's a note. Genuine factual corrections and broken references are the one cheap
exception: fix them inline without ceremony (they don't move the design, so they don't
cost a round).

Two things follow that are worth stating outright, because the instinct runs the other way:

- **A note is not a deferral or a loss.** The implementing agent reads the notes section
  as input. Recording a good observation there is *how* it gets acted on — at the altitude
  where it can actually be judged against real code. Folding it into the spec instead
  pretends the spec can settle it, which is the mistake.
- **Volume is not signal.** Ten below-the-bar comments do not add up to one spec-level
  problem. Ten notes is a normal, healthy review of a directional document.

### The convergence rule

**Default budget: two review rounds per spec PR** (a *round* = one pass over the batch of
feedback outstanding since the last push). After the second round, the spec has converged:
declare it, surface it to the human for the approval gate, and carry every remaining
open thread as implementer notes. Spend a third round only when round two surfaced a
genuine **spec-level** finding — a new approach question, not more notes. Say so when you
do, in one line, so the extra round is a visible decision rather than drift.

Two mechanics the budget depends on, or it misfires:

- **Count rounds spent, not events dispatched.** A batch that was *only* factual corrections
  or broken references costs **zero** — those get fixed inline precisely because they don't
  move the design. The reviewing sub-agent reports the rounds it actually spent, and the
  coordinator adds that; incrementing per event would let two typo batches exhaust the budget
  and then suppress the substantive feedback the budget exists to make room for.
- **The conditional third round has to survive the coordinator.** The sub-agent reports
  whether it found anything spec-level; a coordinator that stops unconditionally at two would
  swallow the very round this rule authorizes. Gate the stop on that flag, not on the count
  alone.

Both are failure modes of a *coordinator following a procedure*, which is why under
`epic-lifecycle` they are no longer a procedure: `epic-wake`'s `atReviewBudget()` is the
executable form of this rule, asserted by the workflow harness (including that a fourth round
is refused after a third, and that a zero-round batch consumes no budget). A **third mechanic**
only code reliably gets right joins them there — **the counters have to survive the wake.**
The script has no memory, so the coordinator carries `specReviewRounds` / `specLevelFound` in
`.orchestration/` and passes them back in every time; drop them and the budget silently
restarts at zero, which reads exactly like a spec that never converges. Standalone
`issue-lifecycle` still applies all three as written above — **this section stays canonical for
both**, so change it here first, then both implementations.

**The budget applies to the epic PR too**, on the same terms — the epic-spec is a direction
artifact reviewed at the same altitude, and it's the one surface where an unbounded review
loop would otherwise survive, sitting directly on the top-level gate. The coordinator holds
that counter itself (`reviewRounds`, historically `epic_review_rounds` — both are read), because `epic-agent` persists nothing between
dispatches. Bounding the *folding* doesn't bound the epic's *direction*: feedback still flows
in and gets routed continuously, and the objective gate still turns only on a human approval.

Three facts make that budget safe rather than reckless:

- **An unresolved thread on a spec PR blocks nothing.** The spec PR is *never merged* —
  `issue-implement` closes it unmerged when implementation starts. It has no merge gate,
  so open threads have no gating power. Do not drive them to zero; that's a habit borrowed
  from code PRs, where it's correct, and it does not transfer.
- **Nothing is lost by converging.** Below-the-bar feedback lands in the notes section and
  reaches the implementer. Above-the-bar feedback was folded in. There is no third
  category that needs another round to rescue it.
- **Implementation is a second review, and a better one.** The design gets challenged
  again against real code (`issue-implement`'s challenger), the diff gets the full
  `review` panel, and a spec blind spot that surfaces there is folded back and flagged.
  A spec doesn't have to be the last line of defence, so it shouldn't be reviewed as if
  it were.

### Reviewers are third-party — control the disposition, not the input

Most spec-PR review comes from **automated reviewers we do not control and cannot
instruct** (Bugbot, Codex, Copilot, and friends). They are tuned for code review, so they
reliably produce line-level, exhaustive, code-shaped feedback on a document that is
deliberately not a finished design. That is expected behavior, not a problem to be
argued with.

So the discipline is ours, not theirs:

- **Triage; don't negotiate.** One reply per thread stating the disposition. Never a
  back-and-forth to reach agreement with a bot, and never a re-review to satisfy one.
- **A reviewer restating a below-the-bar point is still below the bar.** Repetition
  doesn't promote it. Reply once; the second occurrence needs no new answer.
- **Only a human's approving comment or review trips the gate** (see Gates above) — bot
  reviews are explicitly excluded. A bot leaving `CHANGES_REQUESTED` on a spec PR does
  **not** hold the gate, and does not extend the round budget.
- **The spec PR description carries reviewer guidance** (`issue-spec` Step 6) — the static
  contract (what this document is, what to challenge, what is out of scope), collapsed below
  the fold, plus a per-PR *"Parts worth reviewing closely"* above it. The contract is the one
  lever we have on an uninstructable reviewer, it costs nothing, and it measurably raises the
  altitude of what comes back; collapsing it costs a bot nothing and buys the human the first
  screen back. The layout, the rules, the three altitudes, and the failure modes are canonical
  in [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).

### How this shows up in the artifacts

- **`spec-template.md`** — the reviewer contract and the *Parts worth reviewing closely*
  block, and *Review notes for the implementer* (§13) as the home for below-the-bar feedback.
- **`pr-reviewer-guidance.md`** — the two audiences, the PR-description layout, the three PR
  altitudes, and what makes a *Parts worth reviewing closely* block useful rather than
  decorative. Its general half — the fold, the word budgets, the density rules — is
  [`writing-for-humans.md`](writing-for-humans.md).
- **`issue-spec`** Step 6 (reviewer contract in the PR description) and Step 6.5 (the
  triage loop that applies the bar and the budget).
- **`issue-lifecycle`** / **`epic-lifecycle`** — the round counters live in the handle cache
  (`specReviewRounds` + `specLevelFound` per issue; `reviewRounds` + `aboveBarFound` for the
  epic PR); the coordinator declares convergence and surfaces the gate.
- **`.agents/workflows/epic-wake.js`** — `atReviewBudget()`, the executable copy of the
  convergence rule, applied to issue specs and the epic PR alike. Its harness
  (`.agents/workflows/verify.mjs`) is where the rule's edge cases are pinned down.
- **`issue-implement`** — reads the notes section as input; an unaddressed below-the-bar
  spec comment is **not** a blocker to starting implementation.

## PR feedback: the round cap

A spec PR is bounded by the convergence rule above. An **implementation** PR is not, and it
is the other place an unbounded loop lives: several reviewers (human and bot) comment on a
diff, we fix and reply, the fixes draw fresh comments, and each round is individually
reasonable. Nothing in that loop notices that round nine is re-litigating round three, or
that the real problem is the approach rather than any of the lines being argued about.

**Default cap: twelve auto-handled rounds per issue.** A *round* is one pass over the batch
of PR feedback outstanding since the last push — the same unit as a spec-review round, and
the same pass `issue-implement` Step 10 runs. At the twelfth, the lifecycle **stops
auto-handling feedback and asks the human what to do.**

The number is deliberately generous. This is not a convergence budget — a code PR's threads
*do* gate its merge, so unlike a spec PR there is no "converged, carry the rest as notes"
exit. Twelve is a **loop detector**: it is well past a normal review (two to four rounds),
so reaching it is evidence that something structural is wrong, not that the reviewers are
thorough.

### What happens at the cap

1. **Stop.** Dispatch no further feedback rounds on that issue. New comments and CI results
   still arrive and are still recorded; they are simply not acted on.
2. **Say so on the PR**, once: a comment stating that twelve rounds have been handled, what
   is still open, and that the work is paused pending direction. A silent stop reads to a
   reviewer as an agent that died mid-thread — and leaving a code comment unanswered is
   exactly what Step 10.6 forbids.
3. **Surface it to the human**, with what a decision needs: the round count, the threads
   still open, and the assessment the agent actually has — is this converging slowly, or is
   the same objection coming back in different words? Name the suspected loop if there is
   one.
4. **Wait.** The issue is parked. It is offered no merge gate and dispatches no worker until
   the human answers.

The human's answer is a direction, not a permission slip. In practice it is one of: keep
going as-is (the reviews are just heavy); take a specific position on the disputed thread
and stop re-opening it; re-examine the approach, which usually means folding a decision back
into the spec; split the remainder into a follow-up issue; or merge as-is and handle the
rest separately.

**Recording the answer resets the counter to zero**, which is what un-parks the issue — the
same shape as the spec budget's reset, and for the same reason: a fresh direction starts a
fresh loop rather than resuming an exhausted one. Nothing else clears it. An issue whose
answer is never recorded stays parked and stays surfaced every wake; that is a visible
stall, not a silent one.

**What counts.** Count rounds *handled*, not events received, and not comments. A worker
reports the rounds it actually spent; a batch that turned out to be nothing but
acknowledgements and process chatter costs zero, exactly as a spec batch of pure factual
corrections does. A worker that escalated a blocker mid-round didn't finish it and charges
nothing. A round that reports no count is charged one — an unreported round must not be
free, or the cap is unreachable and the loop it exists to catch runs forever.

**The counter is the coordinator's; the count has to travel to the worker.** Every round runs
in a *fresh* sub-agent that cannot read the coordinator's cache, so each feedback dispatch
must carry the running count, the cap, and — on the last allowed round — the instruction to
post the pause comment if the batch turns out to be a real round. Leave it out and the cap
fails in both directions from the same omission: an unprompted worker reports no count, so
every acknowledgement batch is charged one, and the round that reaches the cap parks the issue
with no pause comment on the PR and no assessment for the human. Both implementations owe this
— `epic-wake` builds it into the `pr-feedback` prompt; standalone `issue-lifecycle` builds it
into its dispatch.

**What the cap does not gate.** Only feedback handling. On a multi-PR issue the DAG still
advances — building the next ready slice, rebasing an unstacked one, running the assembled
goal — because none of that is a feedback round, and parking it would stall the issue for a
reason unrelated to the loop.

### Where this lives

- **`issue-implement`** Step 10 — the loop itself counts its rounds and reports them; Step
  10.7 is where the cap is checked and the pause comment is posted.
- **`issue-lifecycle`** — holds `prFeedbackRounds` in the handle cache and owns the ask.
- **`.agents/workflows/epic-wake.js`** — `atPrFeedbackCap()`, the executable copy of this
  rule, pinned by `.agents/workflows/verify.mjs`. As with the convergence rule: **this
  section is canonical for both, so change it here first, then both implementations.**

## Spec-branch POCs (learn before implementing)

A spec is a bet on a direction, and the gate in front of it asks a human to sign that bet
off. Sometimes the honest answer at that moment is *"this reads right and nobody has checked
it."* A **spec POC** is how we check: throwaway code committed to the **never-merged** spec
or epic PR, built so the direction can be validated *before* implementation. The skill is
[`spec-poc`](../../.agents/skills/spec-poc/SKILL.md).

The spec PR is the natural home for it, and this is the property that makes the whole thing
cheap: **it never merges.** Code there can't rot into the codebase, can't accrete public
surface, and doesn't have to be good. So the cost of being wrong about a direction drops from
a rewrite to a deleted branch.

**Two POC mechanisms, and they are not the same one.** They're neighbours in the lifecycle
and get confused constantly:

| | **Spec POC** (this section) | **POC settlement** (next section) |
|---|---|---|
| Fires on | a *trigger* — an unverified premise, a novel composition, a look, a contested fork, an unclear end-state | a **loop** — the same factual claim asserted and counter-asserted twice |
| Answers | *is this direction right?* | *who is right?* |
| For | the reviewers and the human at the gate | the review thread that stopped converging |
| Verdict shape | a summary + code someone can run | `CONFIRMED` / `REFUTED` / `INCONCLUSIVE` |
| Lives | on the spec/epic branch, published | a throwaway worktree, deleted |
| Timing | **before** the gate, usually during authoring | mid-review, after prose failed |

A spec POC is *proactive* — it stops the loop from forming. A settlement is *reactive* — the
loop already formed. Running a POC while authoring is strictly cheaper than settling a claim
in round three, so a trigger noticed early is the best case available.

### The two altitudes

- **Issue altitude** — the spec's premise, composition, ergonomics, or look. See the
  trigger list in the skill; the default is no POC, and a change that extends an existing
  pattern needs none.
- **Epic altitude — the strongest case on the list, and the one only this altitude can
  make.** Every issue under an epic can be individually sound while the *assembled* surface
  is wrong: a seam two issues both want to own, one decision landing in two places, an
  end-state nobody would have chosen if they'd seen it. A rough **end-state POC** — all the
  set's surfaces sketched together, unshipped — makes that visible before the objective gate,
  which is the last moment the *division into issues* is cheap to change. It is recorded in
  the epic-spec's [§3 Shape of the whole](epic-spec-template.md).

Where a direction fork is genuinely contested, a POC can carry **2–3 radically different
variants**, compared on one page, and the chosen one becomes a numbered §6 Decision. Equal
effort on each is the rule that matters — a strawman variant manufactures consent for the
option the author already preferred and puts a human's approval on it.

```mermaid
flowchart LR
  A[spec / epic authoring] -->|trigger fires| P[spec-poc<br/>on the never-merged branch]
  P --> S{what it showed}
  S -->|premise held| R1[record in §7 / §3<br/>no change]
  S -->|premise false| R2[fold before the gate<br/>cheapest version of the discovery]
  S -->|variants| R3[human picks → a §6 Decision]
  R1 & R2 & R3 --> G([approval gate])
  P -.->|non-blocking, but disclosed| G
```

### What it costs, and what it never does

- **Zero review rounds.** Like a factual correction and like requesting a settlement, a POC
  doesn't move the design by argument — it moves the question out of prose.
- **Non-blocking.** The spec keeps converging while it's built and the gate stays reachable.
- **Disclosed, though.** A gate surfaced while a load-bearing POC is still in flight must
  say so — the human can approve anyway, and usually should, but not on a premise nobody
  mentioned was unchecked. Same rule as an in-flight settlement.
- **It never gates and it never decides.** A POC informs the human's call at the gate; no run
  answers *"should we build this?"*
- **It never merges, and it is consumed before implementation.** The implementation branch is
  cut from fresh `origin/main`, never from the spec branch (see "Worktree branching"), so
  nothing on the spec branch reaches `main` by default. **Whatever an implementation PR does or
  doesn't carry over from the spec branch, the POC is never part of it** — a characterization
  test worth keeping is re-written under `tdd` as a real CI spec or a `goals/` entry, graduated
  rather than copied. Closing the spec PR also **deletes its branch** (BP-037), which is fine
  because the POC's job finished at the gate — but it means the durable citation is **the PR**
  (GitHub keeps a closed PR's diff viewable), never the branch. An *epic* branch is never
  deleted, so an epic POC keeps a live home for the life of the epic.
- **CI stays green without weakening it.** POCs live in `spec-poc/<ISSUE-ID>-<slug>/`, outside
  every pnpm workspace, so `turbo`-driven typecheck and test never reach them. That matters
  because CI runs on every PR into `main`, spec PRs included, and the coordinator reads that
  signal — a red spec PR is a broken gate. The mechanics live in
  [`spec-poc/README.md`](../../spec-poc/README.md), next to the directory itself.

  **`spec-poc/` (a directory) is not `poc/…` (a branch).** A settlement runs on a branch named
  `poc/<ISSUE-ID>-<slug>`; a spec POC is a *directory* named `spec-poc/<ISSUE-ID>-<slug>/` on
  the spec branch. Two mechanisms, two namespaces — deliberately not the same string.

### Who dispatches it

**No new worker.** A spec POC runs inside the step that already owns the branch: `issue-spec`
(Step 4) for an issue, the `epic-agent` for an epic end-state POC, each in the worktree it
already has. That's deliberate — a POC is part of authoring, not a separate errand, and the
agent that has the spec in context is the one that knows which premise is load-bearing.
(Contrast a settlement, which *is* its own worker: it arbitrates between parties, so it has
to be independent of both.)

### Where the record lives

- **The spec** — §7 in one line (what was built, what it showed), §12 for a premise it
  settled, and a *Spec evolution* entry **only if it moved the design**. At epic altitude,
  §3 instead.
- **The PR description** — the POC block: one runnable command per artifact, the question it
  answers, and that it's throwaway.
- **A POC that changed nothing still gets its line.** "The premise held" is a real result;
  recording only the POCs that found problems teaches the next reader that a quiet POC failed.

## Settling a disputed claim (POC settlement)

Some review threads don't converge because they aren't about direction at all — they turn
on a **factual claim about how the system behaves**. *"A router can't do that."* *"The store
won't preserve ordering there."* *"That capability doesn't compose with a sequencer's state."*
Prose can't settle a claim like that, so the thread flips: round one the spec looks right,
round two the reviewer does, round three someone finds an angle that flips it back. Nothing
in the loop above stops that, because the convergence budget bounds *how many rounds* we
spend and not *what instrument* we use — and argument is the wrong instrument for a question
about reality.

So we stop arguing and run the code. This is tenet 7 (*prove the goal, not the mock*) applied
one altitude up: the same reason a mocked test doesn't prove a feature is the reason a
confident paragraph doesn't prove a design. A **POC settlement** is a throwaway,
goal-shaped check whose only job is to make the disputed claim **falsifiable** and then
falsify it or confirm it. The skill is [`settle-claim`](../../.agents/skills/settle-claim/SKILL.md);
the dispatch shape is the `poc-agent` worker.

```mermaid
flowchart LR
  T[spec-review triage<br/>or cross-spec review] -->|contested factual claim| REQ[requests settlement<br/>costs 0 rounds]
  REQ --> C[coordinator dispatches<br/>poc-agent · worktree · parallel]
  C -.->|spec keeps converging<br/>gate stays reachable| G([approval gate])
  C --> V{verdict}
  V -->|CONFIRMED| N[reply + record as resolved]
  V -->|REFUTED| F[fold: 1 round<br/>outside the budget]
  V -->|INCONCLUSIVE| H[hand back as a<br/>human decision]
```

### When it fires

**The trigger is a *loop*, not an assertion.** Reviewers assert things constantly and most
assertions are handled fine by the three dispositions — a POC is not the answer to someone
being confidently wrong once. What a POC is for is the pattern where the *same* claim keeps
getting re-argued, each pass reversing the last. So the necessary condition is:

0. **The claim has been asserted and counter-asserted at least twice** — it came back after
   being answered, or the spec has already flipped on it, or two rounds each reached a
   different conclusion about it. **One confident assertion is not a loop**; triage it
   normally (fold it, note it, or drop it with a pointer) and only reach for a settlement if
   it returns.

Then all three of these have to hold as well:

1. **The disagreement is about behavior, not taste or direction.** Someone asserts the
   system does (or doesn't) do a thing.
2. **The claim is load-bearing.** If it's false, the spec's approach changes. A contested
   claim the design doesn't rest on is a note, not a settlement.
3. **Running code can decide it.** There is a check whose PASS and FAIL both mean something
   about the claim.

When all four hold, **settle it rather than spending a third round on it** — the repetition is
the signal that prose has failed, and every further round is the loop this exists to break.
Don't wait for round four to notice, and don't fire on round one to look thorough.

### When it doesn't

- **A claim asserted once.** However confidently, however wrong it sounds. Answer it in the
  thread and move on; if it comes back, *then* you have a loop. Settling every assertion would
  turn a two-round review into a POC farm and cost far more than the debate it replaced.
- **Taste, naming, layout, structure.** Below the bar → an implementer note. No experiment
  arbitrates preference.
- **Direction and scope** ("should we build this at all"). No run settles a value judgment.
  That's the human's call, or a `fable-candidate` if the fork is genuinely hard.
- **The answer is already in the repo.** Read the code, the test, or the doc first — a POC is
  the *second* resort, and a settlement that a two-minute read would have produced is waste.
  Cite the code in a reply instead; that's a Drop with a pointer.
- **It can't be reduced to a runnable falsification.** Then it isn't empirical, whatever it
  sounds like. Hand it up as a decision the human makes.

### Who dispatches, and why it doesn't block

**Workers request; the coordinator dispatches.** A bounded worker (an `issue-worker` running
a triage round, `cross-spec-review`) exits at the end of its step, so a sub-agent it spawned
has nowhere to report back to. It therefore returns a **settlement request** — the claim slice
below — and the coordinator dispatches the `poc-agent` in its own worktree, in parallel with
everything else it's running. Same shape as a `fable-candidate`, with two deliberate
differences: a POC needs **no human approval** (it's cheap and throwaway, where Fable is a paid
escalation), and it **never gates anything**.

**The claim slice — what the dispatcher owes, and where it grows.** One canonical shape, so a
request written in one place is executable in another:

```
claim:   <the disputed assertion, as "X does / does not Y">
load:    <what in the spec's approach depends on it>
falsify: <the observation that would prove it false>
threads: <where it's being argued — PR thread link(s), or the conflicting specs>
```

Those four are **the dispatcher's** — a requester that can't fill `falsify` hasn't got an
empirical claim and should route it as a decision instead. The **executor expands** them into
the runnable check (`check` · `confirms` · `refutes` · **`anti-game`**) as `settle-claim`
Step 1; the dispatcher never pre-writes those, because designing the check is the executor's
job and a pre-written one biases it toward the requester's expected answer.

**Vocabulary — one mechanism, four surfaces.** `Settle` is the triage disposition (`issue-spec`
6.5.1), `settle_requested` is the field a worker returns it in, `settling` is the coordinator's
status column while it's in flight, and `poc-candidate` is `cross-spec-review`'s report flag
(named for symmetry with `fable-candidate`, which sits beside it in the same table). Different
surfaces, one mechanism — the names differ because the *roles* do, not because they drifted.

**Bound the fan-out.** A POC is a full worktree, so it costs roughly what an issue worker costs
and competes with them for the same VM. Dedupe before dispatching (one claim argued in two
places is **one** settlement, fanned to both), and queue rather than exceed the concurrency
cap — a settlement that starts a wake later still beats two more rounds of argument. If you
find yourself dispatching more than one or two at once, the trigger has slipped from "a loop
formed" to "someone asserted something"; that's the POC farm this section exists to prevent.

Under `epic-lifecycle` the bound is mechanical rather than remembered: `epic-wake` normalizes
and dedupes the claim set, draws settlements from the same cap as the issue workers *after*
them (so a POC queues instead of starving one), and routes each verdict to every issue the
claim was argued on as soon as that POC returns. What stays judgment is the **trigger** — the
loop has to have formed — and the cap is no defence against a trigger that fires too easily.

Non-blocking is load-bearing. While the POC runs: the triage round finishes, remaining
feedback lands as notes, the spec converges on schedule, and the approval gate stays
reachable. Sibling issues under an epic are untouched. An agent that owns its own session
(standalone `issue-spec`) can dispatch the POC itself and collect the verdict inside the same
round — the request/dispatch split is about who survives long enough to receive the answer,
not about ceremony.

**Non-blocking, but disclosed.** When a settlement is in flight on a load-bearing claim, say
so where the gate is surfaced: *"spec is converged and up for approval; the claim that X
composes with Y is being checked empirically, verdict will land on the PR — if it comes back
REFUTED after implementation starts, we fold it back the same way a challenger-surfaced blind
spot is folded."* The human can approve anyway — that's their call to make knowingly, and it
usually is the right one. What they must not do is approve on a premise nobody mentioned was
contested.

**Run it against fresh `origin/main`, or the verdict is worthless.** A worktree worker inherits
the *coordinator's* checkout, which drifts behind `main` as sibling PRs merge (see "Worktree
branching" above). A POC run on stale code can confirm a claim that the current code refutes —
a **false settlement**, which is the one output worse than no settlement, because it closes the
question wrongly and carries evidence to prove it. So the `poc-agent` re-bases before it reads
anything: `git fetch origin main && git checkout -B poc/<ISSUE-ID>-<slug> origin/main`. Same
rule as every other issue branch, and load-bearing for a different reason.

**A verdict can outlive the gate — that's allowed, but it must land somewhere.** Because
approval isn't blocked, a settlement can still be running when the spec is approved and
implementation starts. Two rules keep that from stranding a `REFUTED` verdict:

- **Keep the spec PR open while a settlement on a load-bearing claim is in flight.** Approval
  still releases implementation immediately — nothing blocks — but the coordinator *defers the
  spec PR's close-and-delete* until the verdict lands, so the fold has a live artifact and a
  live thread. Closing it is cleanup, not a precondition for implementing. (If it was already
  closed, the Linear document is canonical from then on and the fold goes there.)
- **A late `REFUTED` is a spec blind spot, handled by the path that already exists.** Fold it
  into the spec, tell the in-flight implementation, and re-gate if the direction actually
  changed — exactly what `issue-implement`'s challenger does when it finds the design wrong
  against real code. Discovering this from a POC is the *cheap* version of that discovery.

### What it costs (the round-budget interaction)

The settlement has to *replace* debate rounds, not add to them:

- **Requesting one costs zero rounds.** Same rule as a factual correction — it doesn't move
  the design, it moves the question out of prose.
- **Folding a verdict that changes the approach costs one round, outside the two-round
  budget.** New evidence is not another opinion, and a spec-level finding backed by a run is
  the most valuable thing a review produces. Say in one line that the extra round was
  evidence-driven.
- **A settled claim is closed.** Any later comment re-litigating it — from a bot, from a
  human, from a fresh angle — gets **one** reply pointing at the evidence, and costs **zero**
  rounds. This is the rule that actually kills the flip-flop: without it, the settlement
  becomes round five's opening argument.

### The three outcomes

| Outcome | What it means | What ships |
|---|---|---|
| **CONFIRMED** | The spec's premise held | A verdict reply on the thread + the claim recorded as resolved-with-evidence (§12). **Nothing committed** — the POC is deleted. |
| **REFUTED** | The premise is false; the approach has to change | The same reply, plus the fold (one round, outside the budget) and a *Spec evolution* line: *"After POC settlement — <what changed>, because the run showed <what>."* |
| **INCONCLUSIVE** | The claim couldn't be reduced to a check, or the run didn't discriminate | Say so plainly, say why, and hand the claim back as a decision the human makes. **Never** a fabricated verdict — false evidence is worse than an unsettled debate, because it ends the debate wrongly. |

A POC opens a **draft PR only when it produced something worth a human's attention**: it
uncovered a framework bug or genuinely surprising behavior (also file it via
`issue-manager`), the check is worth keeping as a durable regression **goal** in `goals/`, or
its code is the seed of the implementation and reviewers should see the shape. The default
is no PR — a verdict and a link are the deliverable, and throwaway code that gets reviewed
stopped being throwaway.

### Where the record lives

Three places, each for a different reader, none optional:

- **The thread** — the verdict reply, so the reviewer who raised it sees the answer.
- **The spec's §12** — the claim as a *resolved* question with the evidence, so the next
  reviewer (usually a bot with no memory of the thread) can't reopen it blind.
- **The *Spec evolution* timeline** — one line, but **only if the verdict moved the design**.
  A CONFIRMED claim changed nothing, so it earns no entry (same rule as a §13 note).

## How feedback flows (epic ↔ issues)

```mermaid
flowchart TD
  EPR[(Epic PR)] -->|review + human feedback<br/>fanned DOWN by coordinator| Issues
  Issues[Issue specs] -->|comment UP<br/>cross-cutting concern, non-blocking| EPR
  Coord[Epic lifecycle] -. owns subscription, routes .-> EPR
```

The coordinator owns the epic PR subscription (sub-agents can't hold one) and routes epic
feedback *down* to the aligned issue workers; an issue's `issue-spec` can comment
*up* on the epic PR to raise a cross-cutting concern while it keeps working. All on
existing `subscribe_pr_activity` + PR-comment machinery — no new plumbing.

Fan-out is subject to the same bar as any spec review: an epic comment is fanned down only
when it changes a cross-cutting decision. Below-the-bar epic feedback about one issue's
internals goes to that issue's implementer notes, not into its spec.

## Environment: cloud vs. local (PR subscriptions)

`subscribe_pr_activity` depends on a webhook relay GitHub can call back into — that relay
exists only for Claude's **hosted/cloud environments** (Claude Code on the web, a managed
remote execution environment). A **local** Claude Code CLI session has no publicly
reachable callback endpoint, so subscribing does nothing there even if the call itself
succeeds: no event will ever arrive to wake the session.

**Detecting which one you're in.** A cloud session's system prompt carries an explicit
"remote execution environment" section that a local session's prompt lacks entirely; the
`mcp__Claude_Code_Remote__*` tools (`list_environments`, `create_trigger`, `send_later`)
are similarly cloud-only and won't resolve locally. Check for either before relying on
`subscribe_pr_activity` — don't assume cloud by default.

**Local fallback: poll with `Monitor`, not a scheduler.** Both `Monitor` and `CronCreate`
are harness-native (not cloud-gated), but they poll very differently, and for PR-watching
`Monitor` is the better primitive:

- **`Monitor` (preferred).** Arms a shell poll loop that runs in a **subprocess**; each
  stdout line it emits becomes an event that wakes the session. The loop hits the PR's
  comment / review / check endpoints on an interval (60s+ for a remote API — GitHub rate
  limits) and prints only *new* activity. Because the polling itself is a subprocess, the
  model wakes **only on a real event**, not on every tick — cost is proportional to actual
  PR activity, and the poll behavior is deterministic (fixed shell, not a model turn that
  re-decides each fire). This is the closest local analogue to the cloud webhook stream.
  The **`watch-pr` skill** packages this loop — reach for it rather than re-deriving the
  endpoints; use it as the *primary* wake signal a local coordinator/lifecycle re-enters on.
- **`CronCreate` (only when you need a time-based tick).** Fires a *prompt* on a wall-clock
  schedule, so it costs a full model turn **every** fire whether or not anything changed —
  a poll-and-compare on every empty tick. Use it only for a genuinely time-driven check
  (a low-frequency "is the Monitor still alive / anything I missed" backstop), not as the
  main watch.

**Cover the same signals the cloud path does** (this is where the naive comment-only loop
fails): the watch must poll **PR comments *and* reviews *and* check-runs *and* PR meta**
(`state`/`mergedAt`). Two things the comment-only loop gets wrong:

- A `state: APPROVED` review lives at `pulls/{n}/reviews`, *not* at either comment endpoint —
  omit it and a local orchestrator goes deaf to the exact approval gate above.
- **Merge/close** is a *quiet* transition — no comment, review, or check accompanies it. A
  watch that only polls activity endpoints never sees it, so a local lifecycle waiting on the
  impl PR to merge would hang. `watch-pr` polls the PR-meta each tick so its **continuous 60s
  cadence *is* the heartbeat for that transition** — which is why, locally, it substitutes for
  the `send_later` heartbeat too, not just `subscribe_pr_activity`.

Also advance the comment `since` cursor **only after a successful fetch**: a swallowed
transient `gh` failure that still moved the cursor would drop any comment posted during the
failed interval outside the next window.

**Arming a Monitor is not idempotent — one per PR.** Unlike `subscribe_pr_activity` (safe to
re-call every wake), each `watch-pr` arm spawns a *new* poll subprocess. A coordinator that
re-arms on every refresh would stack duplicate pollers, notifications, and API traffic. So a
local coordinator/lifecycle must **track each PR's Monitor handle in its `.orchestration` cache and
re-arm only when it's missing or dead** — the "re-assert every wake" discipline is for the
cloud subscription, not for local Monitors.

**Read current state at arm time — the Monitor only reports what changes *next*.** The Monitor
primes its snapshot so it emits only post-arm activity — which means anything already true when
it starts (CI that already finished green, an approval already posted) is suppressed and never
fires. A coordinator that arms the Monitor *right after opening a PR* can therefore miss an
already-green CI run, and locally there's no `send_later` heartbeat to re-read — the issue
stalls in `PR_FEEDBACK` on a green PR. So on the wake that arms (or re-arms) a Monitor for a
PR, the coordinator must **immediately re-derive that PR's current CI / review / merge state
and act on it in the same wake** — exactly the re-derive-every-wake discipline; the Monitor is
for subsequent changes, the current state is the coordinator's to read directly.

Two caveats to state to the user up front, not discover later. **(1) Session-only.** A
`Monitor` (like a `CronCreate` job) dies when the session ends, unlike a cloud session's
server-side routines — a local coordinator's "still watching" guarantee is weaker; say so rather
than imply parity. The one thing the Monitor *can't* self-heal is its own process dying, so an
unattended local run should still arm a low-frequency `CronCreate` backstop that re-checks
state and re-arms the watch. **(2) Unproven.** This fallback is the recommended design but
hasn't been confirmed against a live local run yet — verify the `watch-pr` Monitor actually
emits and re-enters the loop the first time a coordinator/lifecycle runs locally, before trusting it
unattended.

## Token discipline (why it stays cheap)

Coordinators (epic lifecycle, issue lifecycle) hold only **handles** — issue IDs, PR#s, branches, a few
lines of phase. Every heavy step (author a spec, implement, maintain the epic-spec) runs
in a **worker sub-agent** that does the work in its own context and returns ≤ a screen.
State is re-derived from durable truth (Linear + PRs + the epic-spec doc), never replayed
from transcript. Idle cost ≈ 0.

Routing the fan-out through a **workflow script** doesn't change that budget — the script holds
no context between wakes either, and its agents are the same isolated workers. It changes
*where the routing decision lives*: in code with a harness rather than in the coordinator's
prompt. The coordinator's own cost stays the table plus the epic record, and it now also stays
the same size regardless of how many issues the wake touched, because the wake returns a
fixed-shape table rather than N summaries to fold.

Event routing follows the same discipline — the coordinator does not read event content. That
rule is **not** a budget rule, so it does not live here; see
[PR events are wake signals, not work items](#pr-events-are-wake-signals-not-work-items) below.

## PR events are wake signals, not work items

**This is a correctness rule, not a cost one**, and the distinction is the whole reason it needs
its own section. Framed as token discipline it reads as negotiable under load — *I'll spend the
tokens, it's fine* — and a coordinator that reasons that way is not being wasteful, it is
breaking two mechanisms. Neither failure is expense.

A PR-activity event arrives in the coordinator's *own* session with the comment bodies and CI
output attached. In the cloud harness, the surrounding system prompt tells that session the PRs
it opened are its own to drive green: diagnose the failure, push the fix, answer the reviewer.
The coordinator genuinely does hold those subscriptions — a sub-agent can't — so it reads as the
owner, and that imperative is louder than anything written here. **Under the lifecycles it does
not apply.** Waking you was the event's whole job, and it has done it.

So on any PR-activity event — a review comment, a CI failure, a push, an approval:

- **Don't** read the diff, diagnose the failure, write a fix, push a commit, or reply on a
  thread. Not for a one-line CI fix, and not because the change looks obvious from the event
  text; "obvious" is what every round nine looked like at round three.
- **Don't** relay the comment text into whatever you dispatch. The thing that handles the PR
  next re-reads its comments, reviews and checks off the activity cursor itself, so a pasted
  copy is a second, staler one.
- **Do** derive the action from durable state — the phase table row, or the wake script — and
  take it. Take it from the row itself, **never from a summary of the row**, including any in a
  skill and including this section. The rows branch on the *kind* of event, and the branches can
  differ in which worker runs, which budget is charged, and whether to dispatch at all. A summary
  that flattens them reads as the rule and quietly outranks the row it came from — which is why
  nothing here lists the routes.
- **Then end the turn — unless what you just read says not to.** Ending is the *default*, not a
  rule of its own, and the same source that gave you the action decides whether the turn is over.
  An epic wake returning `moreWorkNow: true` means something is dispatchable with no external
  event, so the next wake runs **now**; ending there strands ready work until an unrelated event
  or a heartbeat happens along.

**What handling a round yourself actually costs:**

- **The round goes uncounted.** A round budget advances only on a worker's *reported* spend, so
  a round the coordinator handles is invisible to it. The cap then never trips on an issue that
  is genuinely looping — losing the one signal that says the *approach* is wrong rather than the
  lines being argued about.
- **The batch stays `new`.** The activity cursor advances only for actions that consume review
  activity. A batch answered by hand doesn't advance it, so the next wake dispatches a worker
  that re-reads the same batch and re-posts replies to comments already answered.

**Writing to a PR: you may carry a human's decision outward, never a technical judgment of your
own.** Applying a `spec approved` mirror label, or posting an alignment the user just decided in
a cross-spec walkthrough, carries a decision made somewhere the coordinator can see. Answering a
reviewer, explaining a design choice, conceding a point, or calling a finding wrong are all
judgments about a diff it hasn't read, and they belong to the worker that has.

**What stays with the coordinator, because nothing else can hold it:** subscribing to the PR,
surfacing a gate, recording a human's answer to a blocker, and writing the Linear mirror. None
of those acts on review content.

Two reads are the exception, both **small and offloaded to `scout`**, never folded into the
coordinator: the **spec/epic-PR approval check** ("is there an approving comment or GitHub
Review from a human?" — the sign-off gate — checks both the PR's comments and its reviews) and
**epic-PR feedback fan-out** ("which aligned issues does this comment touch?"). Scout returns
the verdict / target list; the coordinator routes on it and, for a detected approval, applies
the mirror label.

**What the coordinator reports instead.** The worker's status line is what it has, and it is
what the user gets: the issue, its phase, the PR, and the worker's one line on what it did. One
line per issue that moved. Don't recap the comments it answered or the fix it wrote — the
coordinator saw neither, and reconstructing them from the event text is the reading this section
forbids, done after the fact and less accurately. If a round produced something that needs the
user, it is a **gate**, a **blocker**, or the **cap**; that gets its own line with the specific
question. Everything else is one line and an ended turn. The point of a coordinator is that
nobody has to read the implementation dialog — narrating it back is the same cost with an extra
hop.

> **Considered and deferred: a dedicated feedback-router sub-agent.** A standing agent that
> triages every incoming event and decides routing was weighed and **not** adopted for v1:
> the coordinator's per-event work is already cheap (PR# → owner → dispatch), content
> reading already lives in the workers, and cross-over signaling already flows via issues
> commenting up on the epic PR. The one genuinely heavy read (epic fan-out targeting) is
> handled by `scout`. Introduce a dedicated router only if event volume and cross-over
> routing outgrow the scout-assisted approach — not preemptively.
