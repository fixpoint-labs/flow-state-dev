# Epic-spec template — the coordination artifact, as a set

An **epic-spec** keeps a set of related issues from being designed in a vacuum. It is **not** an
implementing spec and the issues under it do **not** derive from it — they *reference and align*
to it, and each still writes (or skips) its own spec.

What it is, where it lives, and how it's gated is canonical in
[`orchestration.md`](orchestration.md) → "The epic-spec". The short version:

| | |
|---|---|
| **The epic** | A Linear parent issue carrying the `Epic` label (Kind group); the work is its sub-issues |
| **Where** | `specs/epics/<EPIC-ISSUE-ID>/` on branch `epic/<name>`; Linear links to the repository set |
| **The PR** | Merges after human objective approval and required checks; then preserves the original review history |
| **Author** | `epic-agent`, one bounded change to the existing set per dispatch |
| **The gate** | Human direction approval for the reviewed head, then confirmed merge, before ramping children; see [Gates](orchestration.md#gates-direction-approval-then-confirmed-merge) |
| **After merge** | Live status from Linear and implementation PRs; meaningful amendments via follow-up PRs from `main` |

**Sign-off certifies the objective, not the plan.** Approving an epic says this body of work is
worth doing and the outcome is the right one. It does not sign off any issue's approach — that's
each spec's own gate. The epic-spec is a direction artifact, so the **same two-round convergence
budget and the same three dispositions** as an issue spec govern its PR. Feedback that doesn't
change the objective or a cross-cutting decision belongs to the issues under it.

**The same five required documents and conditional evolution record as an issue spec.** The shape is
[`spec-template.md`](spec-template.md)'s; what each document carries changes with the altitude,
and the change is the whole of this file:

| File | At issue altitude | At epic altitude | Budget |
|---|---|---|---|
| `SPEC.md` | The goal, what changes, for whom | **The goal and how we'll know it's met** · the objective as before/after for the **teams** who feel it · **what's in the box** · **the set, as of review** · **the dependency graph** · what stays as it is · sign-off on the objective | ~1,050 |
| `DECISIONS.md` | D-n cards, the tree | The **cross-cutting calls** as cards · an **ownership matrix** of rule × issue · what was **decided in review** so no child reopens it · what the end-state POC showed | ~1,300 |
| `BUSINESS-RULES.md` | BR-n: when → then → proved by | **ER-n: the rules every child obeys**, with owner and where each is checked · what no child may do · how the set is run · what done means | ~800 |
| `PLAN.md` | Surfaces, DAG, checks, guardrails — for the implementer | **Sequencing, not building**: **the path** as lanes against time · what each issue consumes, delivers and releases · what unblocks what · coordination seams · not-children · the wrap | ~900 |
| `DOCS.md` | Concrete proposed prose for the issue's changed surface | Shared reader narrative, destination operations, and which issue publishes each specific | Changed material only |
| `EVOLUTION.md` (conditional) | Relevant predecessor decisions/rules | Cross-epic or multi-issue lineage, without duplicating child-specific evolution | Relevant lineage only |
| `figures/` | One SVG the PR body carries (what changes); *how we'll know* is an inline mermaid fence, not a file | Three SVGs the PR body carries (the box, the ownership matrix, the path), plus the inline *how we'll know* fence | — |

**The nav line is the same at both altitudes.** The third line of every document is
`[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)` with
the current one bold and unlinked ([`spec-template.md`](spec-template.md)), so a reader who lands
on the rules from a child's spec PR can flip to the decisions without climbing to the directory.
Append `[Evolution](EVOLUTION.md)` only when present.

**The plan is the document that changes most.** An issue plan says how to build one thing; an
epic plan says what order N things run in, what each one entails, and what each hands the next.
So its figure is time, not structure. It has no checks column, because each child's plan owns
those.

**Status is not a retained spec's authority.** The set table is an explicitly dated
snapshot of the reviewed scope, with links to Linear and implementation PRs for live
state. Graphs and path figures change when scope or dependencies change, not on every
phase tick. Before filing an issue, use a dashed **`FIX-XXX · working title`** node;
replace it with the actual ID when scope is made concrete. After merge, meaningful
changes follow [the amendment rule](orchestration.md#merging-and-amending-a-spec).

**One epic-spec is smaller than one issue spec** in what it decides. If `DECISIONS.md` is longer
than the specs it coordinates, it has stopped being a coordination artifact and started being a
design nobody signed off. Cross-cutting decisions only.

**Where the old sections went:**

| Was | Now |
|---|---|
| §1 Purpose & objective, the holistic necessity check | `SPEC.md` — the goal and how we'll know it's met, the teams table, *what's in the box*, the set with *why the set needs it*, the sign-off |
| §2 Themes | `DECISIONS.md` — the cross-cutting calls as cards, and *decided in review* |
| §3 Shape of the whole (the POC) | `DECISIONS.md` — *what the end-state POC showed*, four lines |
| §4 Running index | `SPEC.md` — the reviewed set with links to live Linear status and implementation PRs |
| §5 Open cross-cutting questions | `DECISIONS.md` — *decided in review* once answered; a live one is an ask in the PR body |
| The explainer | Retired. Its panels are the box figure, the set table, the ownership matrix and the path |

**How to read the rest of this file.** Every document is its instruction followed by a worked
example. The example is one imaginary epic — stream resilience, three sub-issues and a closure issue —
so it reads end to end. Copy the shape, not the content.

---

## How to review this

*(Paste verbatim into the epic PR description's collapsed `<details>` block, the same way a spec
PR carries its own contract. Most epic-PR review is automated reviewers we can't instruct, and
this text is identical on every epic PR — so it sits **below the fold**. The visible half is
authored per PR. Layout and rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

This is an **epic-spec**: the shared objective and cross-cutting decisions for a *set* of
issues, in a retained document set. It is not any one issue's implementation design.

**In scope to challenge:**

- The objective and **the goal** in `SPEC.md` — is this body of work worth doing, and is the
  goal the real need at full size, or a smaller one the set could meet while the need stays
  unmet? Would the closure issue's check fail if the goal were not met?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too much.
  That question can only be asked here.
- A cross-cutting decision in `DECISIONS.md` — shared surface, naming, sequencing, contracts.
- A rule in `BUSINESS-RULES.md` with no owner, or two.
- A missing issue the objective implies, or one in the set that doesn't serve it.
- Shared promises and publication ownership in `DOCS.md`; missing or misleading
  predecessor treatment in conditional `EVOLUTION.md`.

**Out of scope — owned by the individual issue specs:**

- Any single issue's approach, architecture, file layout, or test plan.
- Anything that touches exactly one issue. It belongs on that issue's spec PR.
- **The figures, at the pixel level**, and routine status movement since the dated snapshot.
- **POC production polish.** End-state experiments under the owning spec's `poc/`
  show shape and scoping, not shippable implementation. Directional evidence, experimental
  isolation and absence of secrets/generated dependencies remain in scope.

Feedback in the second list is routed to the issue it concerns as an implementer note, not
folded in here.

Required repository checks, approvals and review-thread policy still govern merge.
Optional comments are triaged, not a reason to grind to zero or restart the design review.

---

## The PR body

*(Authored for the reviewed revision, with dated status and pinned figures. After merge,
leave this original review record intact; a follow-up amendment describes its own delta.
Budget ~525 prose words above the fold. Rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

The teams table from `SPEC.md`. Then **the goal** in its one sentence, the *how we'll know*
figure as a mermaid fence with its sentence, and one line naming which issue's goal check
proves it and the control that must fail. **What's in the box**, pinned, with its sentence. **Why now.**
**The set** in one line each, with as-of counts and links to live Linear/PR state. **The
path**, pinned, with a sentence — this is what a reader arriving mid-epic wants first. **Who owns
what**, pinned, with a sentence. Then **Sign off**: the objective and the one or two cross-cutting
calls that pass the filters, compact form. Then **Reviewers · look here** at epic altitude. Then
the links line and the collapsed contract.

> ```md
> # spec(epic): a dropped connection is a non-event (FIX-770)
>
> | A team that… | Today | After this epic |
> |---|---|---|
> | **ships to phones** | Every blip duplicates the answer on screen | Nothing visible happens |
> | **derives totals from the stream** | Defends against duplicates by hand | Counts each item once, with no code of their own |
> | **has a connection go silently dead** | Never reconnects, because nothing noticed | Notices within a heartbeat and resumes |
> | **wants their own reconnect policy** | Writes it | Still writes it; the default is one line to override |
>
> **Goal:** an app built on FSD that does nothing special survives a dropped *or silently dead*
> connection, and its user sees the answer they would have seen anyway.
>
> ```mermaid
> flowchart LR
>   A["a real app · a real streamed answer"] --> L1["leg a · drop the connection"]
>   A --> L2["leg b · let it die silently"]
>   L1 --> T["the transcript the client assembled"]
>   L2 --> T
>   T -->|"equals the uninterrupted run, both legs"| P["PASS · the epic's goal is met"]
>   C["control · heartbeats off"] -.-> L2
>   L2 -.->|"under the control"| F["must FAIL · leg b never resumes"]
> ```
>
> Two legs, because resume alone passes leg a and still leaves the user staring at a dead
> answer. Proved by the closure issue's goal check; why this goal and not a smaller one:
> [SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met).
>
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/end-state.svg" width="940" alt="What's in the box: resume and heartbeats; composed in by the app: reconnect policy; not built: offline queueing and a durable history" />
>
> Inside the box is what an app gets for nothing. The fence keeps a stream from becoming a store.
>
> **Why now.** Mobile is the first thing every app built on FSD ships to, and every one of them
> is re-implementing the defence.
>
> **The set:** three issues and a closure issue. Resume, heartbeats, a backoff default, and the
> QA run that drops a real connection. As of 2026-07-05: 1 done, 2 in flight, the closure
> issue's plan in review; [the spec](SPEC.md#the-set--as-of-2026-07-05) records that snapshot and links to live state.
>
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/path.svg" width="940" alt="The path: one lane per issue against time, resume done, heartbeats and backoff in flight at the now line, the closure lane empty until both land" />
>
> As of the review snapshot, heartbeats and backoff are the one parallel window.
>
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/ownership.svg" width="940" alt="Who owns what: five cross-cutting rules by four issues, each rule with exactly one owner" />
>
> Every rule has one owner. Two would be a seam; none would be a gap.
>
> ## Sign off
>
> 1. **A dropped connection is worth three issues and a closure run, now.** If wrong: a cycle on
>    resilience nobody notices, which the closure run exists to make impossible to miss.
> 2. **Nothing in this epic adds a public config option.** If wrong: the first app that needs a
>    knob comments up, and the set stalls on a cross-cutting question.
>
> **What would change my mind on 1:** evidence that reconnects are rare enough that apps don't
> notice them. Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The rules every child
> obeys: [BUSINESS-RULES.md](BUSINESS-RULES.md).
>
> ## Reviewers · look here
>
> - **Is it three or two?** FIX-777, the backoff default, is the one I'd cut. Kept and scoped
>   to a default with no knobs; the reasoning is in the spec. A wrong answer costs an issue.
> - **Rules → ER-4.** The client is the only reconnect actor. If it falls, the epic's scope
>   changes, not one issue's design.
>
> **Not here:** any single issue's approach. Those are the spec PRs.
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
> · Linear FIX-770 · Project: Streaming · merges after human approval and required checks
>
> <details>
> <summary><b>How to review this</b> — an epic-spec, not an implementation plan</summary>
>
> *(the block above, verbatim)*
>
> </details>
> ```

Before merge, keep figure pins consistent with the reviewed revision. After merge,
do not rewrite the original PR body to look current; live status belongs in Linear
and implementation PRs. Follow-up amendments pin their own figures.

---

## `SPEC.md` — the objective, the box, the set

The document the product owner reads at the gate and everyone reads when they arrive mid-epic.
Sections, in order:

1. **The header line** — epic · N issues · project · the objective it serves, and the links.
2. **Teams, before and after** — a table: a team that… · today · after this epic. Three to
   five rows. This is the objective stated in observable behaviour.
3. **Why now**, in a paragraph.
4. **The goal, and how we'll know it's met** — the same four parts as an issue spec
   ([`spec-template.md`](spec-template.md#the-goal-and-how-well-know-its-met)): the goal in one
   sentence, *is it the right goal?*, the figure, and *how we verify*. At this altitude the
   goal is the epic's outcome, *smaller, and rejected* is usually a subset of the issues
   passing on their own, and *how we verify* names the **closure issue's** goal check as what
   proves the whole ([`orchestration.md`](orchestration.md#the-closure-issue-every-epic-ends-in-qa)),
   not a check of its own.
   Each child spec still states its own goal, and says in *the real need* which part of this
   one it carries.
5. **What's in the box** — the one figure: in the box · composed in by the app · replaced in
   one line · not built. And its sentence.
6. **The set · as of `<date>`** — the reviewed snapshot: issue · what it delivers · why the set needs
   it · status with PR links. Then the counts line and the holistic necessity check in a
   paragraph: whether N is really N−1, and the collapse trigger if one was named. The closure
   issue is a row from the first revision, marked **closure · required**; a bug its runs find
   joins the table as a row that blocks it. **A bug row carries no spec PR by design** ([`orchestration.md`](orchestration.md) → "Which issues get
   a spec"); an empty cell there is correct.
7. **How the issues flow into each other** — the dependency graph as mermaid, edges labelled
   with what one issue hands the next, inputs from other epics dashed, unfiled issues as
   placeholders. Then the legend sentence.
8. **What stays as it is** — the neighbours the set deliberately leaves alone.
9. **Sign off** — the goal first, then the objective and the cross-cutting calls that pass the filters, each linking
   its card, each with *If wrong:*. **Open: none**, or the live forks named.

> # FIX-770 · Stream resilience: a dropped connection is a non-event
>
> **Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> Epic · 4 issues · Streaming · Goal 1, validate through real usage
>
> ## Four teams, before and after
>
> | A team that… | Today | After this epic |
> |---|---|---|
> | **ships to phones** | Every network blip is visible as a duplicated answer | An app that does nothing special survives a reconnect |
> | **derives a total from the stream** | Double-counts on every reconnect, or dedupes by hand | Counts each item once |
> | **has a connection go silently dead** | Never reconnects, because nothing noticed it died | A heartbeat makes the death detectable, and resume fires |
> | **wants their own reconnect policy** | Writes it from scratch | Overrides a shipped default in one line |
>
> **Why now.** Mobile is the first surface every app built on FSD ships to, and each of them is
> re-implementing the same defence. The cost isn't a crash; it's every app carrying stream
> hygiene code that belongs in the transport.
>
> ## The goal, and how we'll know it's met
>
> **An app built on FSD that does nothing special survives a dropped or silently dead
> connection, and its user sees the answer they would have seen anyway.**
>
> | Is it the right goal? | |
> |---|---|
> | **The real need** | Every team shipping to phones is re-implementing stream hygiene. They need to stop, not to get a better tool for doing it |
> | **Smaller, and rejected** | "Resume ships." FIX-775 alone meets it, and a connection that dies without closing never triggers a resume, so the user still waits on a dead answer |
> | **Bigger, and not this epic's** | "The app works offline." Queueing and a durable history make a stream into a store. Its own epic, if ever |
> | **Not done if** | Every child is Done and the closure issue's goal check hasn't run · the closure run only ever drops the connection cleanly · an app has to add code to pass · a bug the closure run found is open |
>
> ```mermaid
> flowchart LR
>   A["a real app · a real streamed answer"] --> L1["leg a · drop the connection"]
>   A --> L2["leg b · let it die silently"]
>   L1 --> T["the transcript the client assembled"]
>   L2 --> T
>   T -->|"equals the uninterrupted run, both legs"| P["PASS · the epic's goal is met"]
>   C["control · heartbeats off"] -.-> L2
>   L2 -.->|"under the control"| F["must FAIL · leg b never resumes"]
> ```
>
> Leg b is the one the smaller goal would have skipped. With heartbeats switched off it must
> fail, which is what makes its PASS mean something.
>
> | How we verify | |
> |---|---|
> | **Goal check** | The closure issue's goal check (FIX-782), real model, in an app that sets nothing, on one `main` commit after every other child merges. Its clean run is the epic's wrap condition ([ER-13](BUSINESS-RULES.md)) |
> | **Signal** | Both legs: the assembled transcript equals the uninterrupted run, with no duplicate and no gap. Leg b resumes within one heartbeat interval |
> | **Input** | A held-out prompt; the drop point and the death point are chosen at random each run |
> | **Anti-game** | Don't assert on a child's own output, or run in an app with custom reconnect code. Both pass while a plain app still breaks |
> | **Control that must fail** | Heartbeats off: leg b must FAIL. Today's `main`: both legs must FAIL |
>
> ## What's in the box
>
> ![Three regions: in the box, resume from a cursor and heartbeat frames, with a fence that says no retention; composed in by the app, its own reconnect policy over the shipped default; a strip of what's not built: offline queueing, a durable history](figures/end-state.svg)
>
> Everything inside the box is what an app gets for nothing. The fence is the decision that keeps
> it cheap: the server holds no per-client state and retains nothing past a request's lifetime
> ([D2](DECISIONS.md#d2)). The bottom strip is what the set refuses to build.
>
> ## The set · as of 2026-07-05
>
> This table is the live one. It's refreshed on the epic PR as issues move; the plan and the
> figures point here rather than repeating it.
>
> | Issue | What it delivers | Why the set needs it | Status |
> |---|---|---|---|
> | FIX-775 | Resume from a sequence cursor | The substance | **Done** · [#830](https://github.com/o/r/pull/830) |
> | FIX-776 | Heartbeat frames so a dead connection is detectable | Without it a silently dead connection is never reconnected, so resume never fires | Impl in review · spec [#815](https://github.com/o/r/pull/815) · impl [#841](https://github.com/o/r/pull/841) |
> | FIX-777 | A default reconnect backoff in the client, no options | The weakest of the three: apps can set their own. Kept, scoped down; a knob during implementation is the signal it should have been dropped | Spec in review · [#818](https://github.com/o/r/pull/818) |
> | FIX-782 · closure · **required** | The QA run on one `main` commit: a real client dropped mid-stream and asserted on the transcript, each team's journey, every child's goal check | The only child shaped to move Goal 1, and the one that finds what falls between the others | Plan in spec review · blocked by FIX-775, FIX-776, FIX-777 |
> | FIX-781 | Reconnect drops the last partial frame | A **bug** found by FIX-775's goal check | Fixed · [#833](https://github.com/o/r/pull/833) |
>
> 2 done · 3 in flight. Three are substance, one is the closure issue, one was a bug FIX-775's
> goal check found. A bug the closure run finds joins this table the same way, as a child that
> blocks the closure issue. Whether three is really two was argued at the gate: FIX-777 stays, scoped to a
> default with no options, and the collapse trigger is a knob.
>
> ## How the issues flow into each other
>
> ```mermaid
> flowchart LR
>   A["FIX-775 · resume"] -->|"the cursor"| B["FIX-776 · heartbeats"]
>   A -->|"the cursor"| C["FIX-777 · backoff default"]
>   A --> P["FIX-782 · closure · required"]
>   B --> P
>   C --> P
>   A -.->|"found"| X["FIX-781 · partial-frame bug"]
>   classDef done stroke-width:2px
>   class A,X done
> ```
>
> An edge is what one issue hands the next. A dashed node isn't filed yet and reads `FIX-XXX ·
> working title` until it is; a heavy border is done. Only heartbeats and backoff ever run in
> parallel, and the closure issue waits on all three.
>
> ## What stays as it is
>
> - Client reconnect *policy* beyond the shipped default. The app's.
> - The store. Nothing here serves a response to a client that was never attached.
> - Offline queueing, and any *new* durable history. Both turn a stream into a product-level
>   log, which is a different decision and its own epic.
>
> ## Sign off
>
> **[The goal](#the-goal-and-how-well-know-its-met), at that size:** dropped *and* silently
> dead, in an app that sets nothing. If wrong: we wrap an epic whose users still hit a dead
> answer, or we carry a closure leg nobody needed.
>
> 1. **[D1](DECISIONS.md#d1) · A dropped connection is worth three issues and a closure run, now.**
>    If wrong: a cycle on resilience nobody notices, which the closure run exists to make impossible
>    to miss.
> 2. **[D2](DECISIONS.md#d2) · The client is the only reconnect actor; the server holds no
>    per-client state.** If wrong: the epic's scope changes, not one issue's design — retention
>    rules, and a store that grew by accident.
> 3. **[D3](DECISIONS.md#d3) · Nothing in this epic adds a public config option.** If wrong: the
>    first app that needs a knob comments up, and the set stalls on a cross-cutting question.
>
> **Open: none.** Every question the set raised is answered in [DECISIONS.md](DECISIONS.md). The
> rules every child obeys are in [BUSINESS-RULES.md](BUSINESS-RULES.md). The order the work runs
> in, and what each issue entails, is [PLAN.md](PLAN.md).

**Under [`epic-pm`](../../.agents/skills/epic-pm/SKILL.md) the sign-off is stricter**: it
carries that skill's five objective lines — Outcome · Proof · Lead measure · Not doing · Kill
line — and the objective gate is refused without them. **Outcome** and **Proof** are the goal
sentence and *how we verify* above; the other three sit between the teams table and *what's in
the box*. `epic-pm` is canonical for what each line owes.

---

## `DECISIONS.md` — the cross-cutting calls

The calls that sit **above any single issue** — shared surface, naming, sequencing, contracts
two issues both touch. Same shape as an issue's decisions ([`spec-template.md`](spec-template.md)
→ `DECISIONS.md`), with two epic-only sections. **If it only affects one issue, it isn't a
cross-cutting decision.** Sections, in order:

1. **The tree.**
2. **One card per decision**, anchored, with *Instead of · Because · Locks in*, and **what would
   change my mind** on the objective.
3. **Who owns what** — the ownership matrix figure: rule × issue, each rule with exactly one
   *decides* or *builds* cell and any number of *consumes* cells. Read a row to see where a
   decision is made, where it's built, and where it's only consumed; a *consumes* cell is a
   place a child must not re-decide.
4. **Decided in review, recorded so no child reopens them** — one line each. This is where the
   answers to cross-cutting questions land once they have one.
5. **What the end-state POC showed** — four lines: built · see it · showed · changed. Omit the
   section when the epic built none, and say so in a line.
6. **How it got here** — one line per turn, newest last. A set-table refresh never earns a
   line; a change to the objective or a cross-cutting call always does.

> # FIX-770 · Decisions
>
> [Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> The calls that sit above any single issue: what was chosen, what lost, why, and what each
> locks in for the four issues under it. Three are the sign-off surface. The rest were raised
> in review and are recorded so no child reopens them.
>
> ## The tree
>
> ```mermaid
> flowchart TD
>   E["FIX-770"] --> D1["D1 · three issues and a closure run, now"]
>   D1 -.->|"rejected"| X1["two · drop the backoff default"]
>   E --> D2["D2 · the client is the only reconnect actor"]
>   D2 -.->|"rejected"| X2["server-side session replay buffer"]
>   E --> D3["D3 · no public config option anywhere in the set"]
>   D3 -.->|"rejected"| X3["a knob per issue"]
> ```
>
> <a name="d1"></a>
> ## D1 · A dropped connection is worth three issues and a closure run, delivered now
>
> | | |
> |---|---|
> | **Instead of** | Two issues, dropping the backoff default · or waiting until an app asks |
> | **Because** | Every app on mobile is re-implementing the defence today. Heartbeats exist to make a reconnect *detectable*; without them resume never fires. The default mostly saves a config line, and is kept scoped to exactly that |
> | **Locks in** | An epic slot for a mostly serial set. A collapse trigger on FIX-777: if it grows a knob during implementation, it should have been dropped |
>
> **What would change my mind:** evidence that reconnects are rare enough that apps don't notice
> them. Then this is polish, and the epic should not finish.
>
> <a name="d2"></a>
> ## D2 · The client is the only reconnect actor; the server holds no per-client state and never initiates
>
> | | |
> |---|---|
> | **Instead of** | A server-side replay buffer serving arbitrary re-reads |
> | **Because** | A buffer turns a stream into a store, and "how long do we keep it" has no good answer at framework level. Per-client state is something that has to expire |
> | **Locks in** | Resume needs no retention rules. Two issues depend on this silently; if it falls, the epic's *scope* changes rather than one issue's design |
>
> <a name="d3"></a>
> ## D3 · Nothing in this epic adds a public config option
>
> | | |
> |---|---|
> | **Instead of** | A knob where each issue finds it convenient |
> | **Because** | Resilience is a property of the transport, not something an app opts into. An issue that finds it needs a knob has hit a cross-cutting question |
> | **Locks in** | A child that needs one comments up on this PR rather than deciding locally. FIX-777 ships a default with no options |
>
> ## Who owns what
>
> ![Who owns what: a matrix of five cross-cutting rules by four issues, each rule with exactly one decides or builds cell and consumes cells elsewhere](figures/ownership.svg)
>
> Every rule in the set has one owner. The columns are the chain; read a row to see where a
> decision is made, where it's built, and where it's only consumed. A cell that says *consumes*
> is a place a child must not re-decide.
>
> ## Decided in review, recorded so no child reopens them
>
> - **One cursor format across the epic: `{requestId}:{sequence}`.** FIX-775 defines it;
>   FIX-776 and FIX-777 consume it as-is. No issue widens it without changing this line first.
> - **Heartbeat frames do not consume sequence numbers.** Raised by FIX-776's spec, commenting
>   up; settled by the POC below.
> - **The cursor is not opaque to clients.** Making it opaque means the server keeps a mapping,
>   which reintroduces the per-client state D2 exists to avoid.
> - **FIX-775 lands first.** The other two are meaningless without a cursor to carry. They can
>   be *specced* in parallel; they can't merge first.
>
> ## What the end-state POC showed
>
> **Built:** all three issues' surfaces sketched together end to end, rough and unshipped — a
> cursor on the stream seam, heartbeat frames, and a client that reconnects — driven by one
> throwaway flow. **See it:** `specs/epics/FIX-770/poc/end-state/` on this branch;
> `pnpm tsx specs/epics/FIX-770/poc/end-state/run.ts` prints the assembled reconnect transcript.
> **Showed:** heartbeats and resume both want to write through the sequence allocator, and each
> issue read alone puts that decision in its own file. **Changed:** the one-cursor rule became a
> constraint on the allocator, not just on the encoding, and allocation moved into FIX-775's
> scope so FIX-776 consumes it.
>
> ## How it got here
>
> - **Drafted (Jul 1)** — three issues under one outcome; backoff scoped to a default with no
>   options.
> - **Review round 1 (Jul 2)** — D2 added, because two issue specs had each assumed it silently
>   and one had assumed the opposite.
> - **FIX-776 commented up (Jul 3)** — FIX-775 merges first; heartbeats can't be specced against
>   a cursor that doesn't exist.
> - **POC settlement (Jul 4)** — heartbeats don't consume sequence numbers. Recorded so a third
>   issue can't reopen it.
>
> **Open: none.**

---

## `BUSINESS-RULES.md` — the rules every issue in the set obeys

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says **who
owns it** and **where it's checked**. Four groups, in order: what a team gets and doesn't · what
no child may do · how the set is run · the closure (what done means).

> # FIX-770 · Rules every issue in the set obeys
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> At epic altitude the rules aren't behaviours of one feature; they're the constraints every
> child spec and implementation must satisfy, and the place a cross-spec review checks. Each
> says who owns it and where it's checked.
>
> ## What a team gets, and what it doesn't
>
> | # | Rule | Owner | Checked at |
> |---|---|---|---|
> | ER-1 | A client that drops mid-stream and reconnects assembles the uninterrupted transcript, item for item | FIX-775 | The closure issue's goal check |
> | ER-2 | A silently dead connection is detected within one heartbeat interval | FIX-776 | FIX-776's tests · the closure run |
> | ER-3 | An app that sets nothing gets a reconnect backoff; an app that sets its own overrides it in one line | FIX-777 | FIX-777's tests |
> | ER-4 | The server holds no per-client state and never initiates a reconnect | FIX-775 (D2) | Every child's spec review |
> | ER-5 | One cursor format, `{requestId}:{sequence}`, across the set | FIX-775 defines · FIX-776, FIX-777 consume | FIX-776's and FIX-777's spec review |
>
> ## What no child may do
>
> | # | Rule | Because |
> |---|---|---|
> | ER-6 | No child adds a public config option | D3. A child that needs one comments up |
> | ER-7 | No child invents a second cursor encoding, or widens the one | Two encodings is the failure the seam exists to avoid |
> | ER-8 | No child retains anything past a request's own lifetime | ER-4's fence; a retention rule is a different epic |
> | ER-9 | No child re-parents FIX-790 (the store's history read) under this epic | Consumed, not owned |
>
> ## How the set is run
>
> | # | Rule | Because |
> |---|---|---|
> | ER-10 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child blocks its dependants whatever its PRs say |
> | ER-11 | A cross-cutting question is raised to the epic coordinator, not decided locally; after merge, any resulting amendment gets a follow-up PR | The retained decisions are canonical; the original PR remains history |
> | ER-12 | Every child's route reads *spec* by default; only a `Bug` label re-routes it | Fail-closed routing |
> | ER-13 | The epic finishes only when the closure issue closes: a clean run on one `main` commit, with every bug an earlier run found fixed as a child of this epic and retested | D1. Surface without proof doesn't move the lead measure |
>
> ## The closure
>
> | # | The epic is done when | Proved by |
> |---|---|---|
> | ER-14 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: both legs pass, and leg b fails under its control | The closure issue's goal check, real model |
> | ER-15 | The docs teach reconnect as something an app gets, not something it builds | FIX-776's docs PR: the streaming overview leads with it |

---

## `PLAN.md` — sequencing, not building

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. Sections, in order:

1. **The path** — the one figure: one lane per issue in chain order, inputs from other epics as
   lanes above, done bars, in-flight bars at the now line, empty lanes after it, the critical
   path drawn through. And its sentence. **Dated; amended when the planned sequence changes.**
2. **What each issue entails** — a table: issue · route · consumes · delivers · releases · size.
   *Consumes → delivers → releases* is the row an issue plan never needs and an epic plan can't
   do without.
3. **Where it is** — links to live Linear and implementation PR state from the set table,
   plus dated evidence for external inputs. Never a second status database.
4. **What unblocks what, from here** — numbered: this merges → that can start.
5. **Coordination seams to watch** — a table: seam · between · rule. The places two children
   edit the same surface.
6. **Not children, deliberately** — the linked issues that are consumed, not owned.
7. **Wrap** — what happens when the closure issue closes.

> # FIX-770 · Plan
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> An epic plan sequences the work and says what each piece entails. It does not say how to
> build any piece; that's each issue's own plan. IDs cross-reference
> [DECISIONS.md](DECISIONS.md) (D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).
>
> ## The path
>
> ![Swimlanes against time: one input lane from the store epic, four issue lanes in chain order, a done bar for resume, in-flight bars for heartbeats and backoff at the now line, an empty closure lane after them, and the critical path drawn through resume, heartbeats and the closure run](figures/path.svg)
>
> A chain with one fork. Only resume could start at the gate. The one parallel window is
> heartbeats beside backoff once the cursor exists, and that's where the set is now. Required
> does not move the closure run earlier: it waits on every other child, and only its QA plan is
> written early. The dependency graph itself is in
> [the spec](SPEC.md#how-the-issues-flow-into-each-other); this document adds time to it.
>
> ## What each issue entails
>
> | Issue | Route | Consumes | Delivers | Releases | Size |
> |---|---|---|---|---|---|
> | **FIX-775** resume | spec → impl PR | The existing sequence numbers · D2 | The cursor, the seam filter, the completed-request boundary, the one allocator | FIX-776 · FIX-777 | Medium |
> | **FIX-776** heartbeats | spec → impl PR | The cursor · the allocator (ER-5) | Heartbeat frames that don't consume sequence numbers; the docs lead | The closure run (with 777) | Small |
> | **FIX-777** backoff default | spec → impl PR | The cursor · D3 | One default, no options, one-line override | The closure run (with 776) | Small |
> | **FIX-782** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit | The committed end-to-end checks, a QA report, and a bug child for every failure | The epic's wrap | Medium, and repeats per retest |
>
> ## Where it is
>
> [The set table](SPEC.md#the-set--as-of-2026-07-05) is the review-time snapshot.
> Follow its Linear and implementation PR links for current status, not the dated swimlanes.
> The one input from another epic: FIX-790, the store's history read, is shipped and ER-9
> consumes it without re-parenting it.
>
> ## What unblocks what, from here
>
> 1. **FIX-776 and FIX-777 merge** → the closure issue's first QA run starts, on a plan approved
>    while they were building. Nothing else waits on them.
> 2. **A closure run finds bugs** → each is filed as a child of this epic that blocks FIX-782.
>    When the last one merges, the whole plan runs again on a fresh `main` commit.
> 3. **A closure run finds nothing** → the closure PR opens with the checks and the QA report.
>    Its merge → wrap: lessons pass, docs polish and a completion report in Linear. The original merged spec PR remains the historical review.
> 4. **If FIX-790's read gains a `from` option during any of this** → FIX-775's seam is
>    unchanged (decided, not asked). No child re-sequences.
>
> ## Coordination seams to watch
>
> | Seam | Between | Rule |
> |---|---|---|
> | The sequence allocator | FIX-775 and FIX-776 | 775 owns it; 776 writes through it. Two allocators and resume skips items |
> | The streaming overview page | FIX-776 and FIX-777 | Both edit it. Whichever lands second links rather than repeats |
>
> ## Not children, deliberately
>
> FIX-790 (the store's history read) · FIX-812 (offline queueing, its own epic). Linked from the
> rules, never re-parented (ER-9).
>
> ## Wrap
>
> When ER-13 holds: run the lessons pass, dispatch docs polish over the children's
> streaming pages, and report the outcome from Linear and implementation evidence.
> Publish meaningful design amendments through a follow-up PR, not a final status commit.

---

## `DOCS.md` — shared narrative and publication ownership

Use the [issue template's documentation contract and example](spec-template.md#docsmd--proposed-documentation-not-a-plan).
At epic altitude, write the shared story once and assign its publication to an issue;
do not pre-write every child's detail. This continues the fictional streaming epic.

> # FIX-770 · Documentation draft
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)
>
> ## UPDATE · `apps/docs/docs/streaming/overview.md` · opening
>
> A dropped connection does not require a new answer. The client resumes the existing
> request from its last received item; heartbeats let it notice a connection that has
> silently stopped delivering data. The built-in reconnect delay supplies a default,
> and an app can replace that policy without replacing resume.
>
> For example, if a phone loses its connection after item 41, reconnecting resumes
> after that item instead of appending items 1–41 again. A completed request returns
> its remaining items and closes. This is recovery within a request, not offline
> queueing or an unlimited history store.
>
> Existing apps need no new configuration to use the default. Apps with a custom
> reconnect policy keep ownership of that policy; the individual issue drafts describe
> cursor handling and the override example before publication.
>
> ## Ownership
>
> | Material | Publisher | Specific draft |
> |---|---|---|
> | Shared opening above | FIX-776, after assembled behavior is verified | This document |
> | Cursor precedence, malformed values and completed-request boundaries | FIX-775 | Its `DOCS.md` |
> | Heartbeat detection limits | FIX-776 | Its `DOCS.md` |
> | Reconnect policy override example and limits | FIX-777 | Its `DOCS.md` |
>
> Publish each specific with its implementation. The shared opening waits until the
> behaviors it promises are available; do not publish it merely because this spec merged.
> No unchanged page is copied here. Later publishers link the first owner's narrative.

## `EVOLUTION.md` — cross-cutting lineage

The [issue example](spec-template.md#evolutionmd--conditional-precise-design-lineage)
shows the row shape. At epic altitude, track only changes spanning children. These
two additional predecessors are **fictional**, and their source paths are illustrative
code spans, not claims that those files exist.

> # FIX-770 · Evolution
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**
>
> | Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
> |---|---|---|---|---|
> | FIX-680 D3 made each app own all reconnect machinery; source `../FIX-680/DECISIONS.md#d3` | **Amended** for the default, retained for overrides | The end-state POC demonstrates one shared resume path instead of three app-owned implementations | This epic D3; FIX-777 owns the default, FIX-775 owns resume | Existing app policy remains an override, not a second reconnect actor |
> | FIX-681 ER-2 forbids durable per-client state; source `../FIX-681/BUSINESS-RULES.md#er-2` | **Retained** | Current architecture keeps persistence request-scoped; the closure run must exercise reconnection without a client-state store | This epic ER-4 and ER-8, owned by FIX-775 | No new durable state or offline queue; no stored-data migration |
>
> Neither predecessor is wholly superseded. FIX-790's store-history API is consumed,
> not superseded. Child-specific cursor changes belong in FIX-775's evolution record.
> Re-check the cited intentions against current code and architecture before implementing.

Use actual historical PR/Linear provenance and precise section IDs when retained files
do not exist; the [canonical retention policy](orchestration.md#spec-retention-and-authority)
defines that case without requiring backfill.

## What refreshes, and when

| Event | Before merge | After merge |
|---|---|---|
| Routine issue/PR phase change | Refresh session status from Linear and PRs; avoid status-only spec churn | Same; no retained-spec commit |
| Scope, dependencies or ownership changes | Amend the open set and affected figures | Follow-up PR from `main` |
| Direction changes or a POC refutes a premise | Redraft and obtain fresh human approval | Pause affected work; follow-up amendment with renewed human approval |
| Wrap | Determine completion from implementation evidence, not spec-PR state | Report completion in Linear; leave original merged PR historical |

Project-spec refresh remains its own unchanged lifecycle. Issue/epic publication follows
[Merging and amending a spec](orchestration.md#merging-and-amending-a-spec); Linear holds
links and status, not a full-content mirror.
