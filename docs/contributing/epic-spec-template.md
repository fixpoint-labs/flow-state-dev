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

**Sign-off certifies the objective, not a plan.** Approving an epic says this body of work is
worth doing and the outcome is the right one. It does not sign off any issue's approach — that's
each spec's own gate. The epic-spec is a direction artifact, so the **same two-round convergence
budget and the same three dispositions** as an issue spec govern its PR. Feedback that doesn't
change the objective or a cross-cutting decision belongs to the issues under it.

**The same two documents as an issue spec.** The shape is [`spec-template.md`](spec-template.md)'s;
what each document carries changes with the altitude, and the change is the whole of this file:

| File | At issue altitude | At epic altitude | Budget |
|---|---|---|---|
| `SPEC.md` | The goal, what changes, for whom, what's already here and the debt | **The goal and how we'll know it's met** · the objective as before/after for the **teams** who feel it · **what's in the box** · **the set, as of review** · **the dependency graph** · what stays as it is · **what's already here, and the set's debt** · sign-off on the objective | ~1,200 |
| `DECISIONS.md` | D-n cards, the tree, review notes | The **cross-cutting calls** as cards · **who owns what**: the ownership matrix and the **ER-n rules every child obeys** · the **coordination seams** · what was **decided in review** so no child reopens it · what the end-state POC showed | ~1,500 |
| `figures/` | One SVG the PR body carries (what changes); *how we'll know* is an inline mermaid fence, not a file | Two SVGs the PR body carries (the box, the ownership matrix), plus the inline *how we'll know* fence | — |

**The nav line is the same at both altitudes.** The third line of every document is
`[Spec](SPEC.md) · [Decisions](DECISIONS.md)` with the current one bold and unlinked
([`spec-template.md`](spec-template.md)), so a reader who lands on the decisions from a child's
spec PR can flip to the spec without climbing to the directory.

**The order the work runs in is the dependency graph.** An epic does not carry a schedule.
`SPEC.md`'s graph says what each issue hands the next, and the coordinator derives what can start
from Linear's blocked-by relations on every wake. A dated swimlane would be stale by the first
refresh.

**Status is not a retained spec's authority.** The set table is an explicitly dated
snapshot of the reviewed scope, with links to Linear and implementation PRs for live
state. The graph changes when scope or dependencies change, not on every phase tick.
Before filing an issue, use a dashed **`FIX-XXX · working title`** node; replace it with
the actual ID when scope is made concrete. After merge, meaningful changes follow
[the amendment rule](orchestration.md#merging-and-amending-a-spec).

**One epic-spec is smaller than one issue spec** in what it decides. If `DECISIONS.md` is longer
than the specs it coordinates, it has stopped being a coordination artifact and started being a
design nobody signed off. Cross-cutting decisions only.

**Where the older documents went.** Epic specs retained before this shape carry five documents,
and sometimes a sixth. Leave them as they are; the coordinator and the children read whatever a
set carries.

| Was | Now |
|---|---|
| `BUSINESS-RULES.md` — ER-n rules with owners | `DECISIONS.md` → *Who owns what*. Rules that restate the process ([`orchestration.md`](orchestration.md)) are not repeated |
| `PLAN.md` — the path, what each issue entails, what unblocks what | `SPEC.md` → the set table and the dependency graph. Live state is Linear's |
| `PLAN.md` — coordination seams, not-children | `DECISIONS.md` → *Coordination seams*; consumed issues are dashed inputs on the graph |
| `DOCS.md` — the shared narrative and who publishes it | One *docs* line in `SPEC.md`, naming the shared story and the child that publishes it |
| `EVOLUTION.md` — cross-cutting lineage | `SPEC.md` → *What's already here* |

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
issues, in a retained document set. It is not any one issue's implementation design, and it
is not a schedule.

**In scope to challenge:**

- The objective and **the goal** in `SPEC.md` — is this body of work worth doing, and is the
  goal the real need at full size, or a smaller one the set could meet while the need stays
  unmet? Would the closure issue's check fail if the goal were not met?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too much.
  That question can only be asked here.
- **The set's debt** in `SPEC.md` — something the set overlaps and doesn't name, or adds and
  doesn't list.
- **Builds on / Adds** in that same section — an Adds item that does not name the existing
  piece it considered, or that is a second mechanism for something we already have
  ([`orchestration.md`](orchestration.md#compose-existing-pieces)).
- A cross-cutting decision in `DECISIONS.md` — shared surface, naming, sequencing, contracts.
- A rule in `DECISIONS.md` → *Who owns what* with no owner, or two.
- A missing issue the objective implies, or one in the set that doesn't serve it.

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
Budget ~525 prose words above the fold. Rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md), including its prose in ASD-STE100
(→ "Language — ASD-STE100"); the rows taken from `SPEC.md` get rewritten to STE, not pasted.)*

The teams table from `SPEC.md`. Then **the goal** in its one sentence, the *how we'll know*
figure as a mermaid fence with its sentence, and one line naming which issue's goal check
proves it and the control that must fail. **What's in the box**, pinned, with its sentence. **Why now.**
**The set** in one line each, with as-of counts and links to live Linear/PR state. **Who owns
what**, pinned, with a sentence. Then **Sign off**: the goal and the set's debt, unnumbered, then
the objective and the one or two cross-cutting calls that pass the filters, compact form — each a
subheading, its trade-off figure pinned ([`spec-figures.md`](spec-figures.md) → "The
trade-off"), and one line naming the row it came down to and *If wrong:*. Then **Reviewers · look
here** at epic altitude. Then the links line and the collapsed contract.

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
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/ownership.svg" width="940" alt="Who owns what: five cross-cutting rules by four issues, each rule with exactly one owner" />
>
> Every rule has one owner. Two would be a seam; none would be a gap.
>
> ## Sign off
>
> **The goal, at that size:** dropped *and* silently dead, in an app that sets nothing. If
> wrong: we wrap an epic whose users still hit a dead answer.
>
> **The set's debt: net down.** Every app's hand-written duplicate defence becomes unnecessary;
> the set adds one shipped default. If wrong: a default nobody can find to override.
>
> ### A dropped connection is worth three issues and a closure run, now · D1
>
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/d1-worth-it.svg" width="940" alt="Three issues and a closure run now, chosen, beside two issues without the backoff default, and beside waiting until an app asks. Decides it: a silently dead connection, which only heartbeats catch. Price: an epic slot for a mostly serial set" />
>
> It comes down to a connection that dies silently: without heartbeats, resume never fires.
> **If wrong:** a cycle on resilience nobody notices, which the closure run exists to make
> impossible to miss.
>
> ### Nothing in this epic adds a public config option · D3
>
> <img src="…/<sha>/specs/epics/<EPIC-ISSUE-ID>/figures/d3-no-knobs.svg" width="940" alt="No public config option, chosen, beside a knob wherever an issue finds it convenient. Decides it: who settles a cross-cutting question, the epic or one child. Price: a child that needs a knob stops and comments up" />
>
> It comes down to who decides: a knob per issue lets one child settle a question for all four.
> **If wrong:** the first app that needs a knob comments up, and the set stalls on a
> cross-cutting question.
>
> **What would change my mind on D1:** evidence that reconnects are rare enough that apps don't
> notice them. Reasoning, what lost and the rules every child obeys:
> [DECISIONS.md](DECISIONS.md).
>
> **Analysis:** right approach. The alternatives pass found no better division of the set.
> [DECISIONS.md → Analysis](DECISIONS.md#analysis).
>
> ## Reviewers · look here
>
> - **Is it three or two?** FIX-777, the backoff default, is the one I'd cut. Kept and scoped
>   to a default with no knobs; the reasoning is in the spec. A wrong answer costs an issue.
> - **Decisions → ER-1.** The client is the only reconnect actor. If it falls, the epic's scope
>   changes, not one issue's design.
>
> **Not here:** any single issue's approach. Those are the spec PRs.
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · Linear FIX-770 · Project: Streaming
> · merges after human approval and required checks
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

1. **Teams, before and after** — a table: a team that… · today · after this epic. Three to
   five rows. This is the objective stated in observable behaviour, and it is the problem, so
   it comes first: nothing sits between the nav line and it.
2. **Why now**, in a paragraph.
3. **The goal, and how we'll know it's met** — the same four parts as an issue spec
   ([`spec-template.md`](spec-template.md#the-goal-and-how-well-know-its-met)): the goal in one
   sentence, *is it the right goal?*, the figure, and *how we verify*. At this altitude the
   goal is the epic's outcome, *smaller, and rejected* is usually a subset of the issues
   passing on their own, and *how we verify* names the **closure issue's** goal check as what
   proves the whole ([`orchestration.md`](orchestration.md#the-closure-issue-every-epic-ends-in-qa)),
   not a check of its own.
   Each child spec still states its own goal, and says in *the real need* which part of this
   one it carries.
4. **What's in the box** — the one figure: in the box · composed in by the app · replaced in
   one line · not built. And its sentence. Then **one docs line**: the shared story readers
   get, and which child publishes it once the behaviour ships. Each child documents its own
   specifics.
5. **The set · as of `<date>`** — the reviewed snapshot: issue · what it delivers · why the set needs
   it · status with PR links. Then the counts line and the holistic necessity check in a
   paragraph: whether N is really N−1, and the collapse trigger if one was named. The closure
   issue is a row from the first revision, marked **closure · required**; a bug its runs find
   joins the table as a row that blocks it. **A bug row carries no spec PR by design** ([`orchestration.md`](orchestration.md) → "Which issues get
   a spec"); an empty cell there is correct.
6. **How the issues flow into each other** — the dependency graph as mermaid, edges labelled
   with what one issue hands the next, inputs from other epics and issues the set consumes
   but doesn't own dashed, unfiled issues as placeholders. Then the legend sentence. This is
   the epic's whole sequencing.
7. **What stays as it is** — the neighbours the set deliberately leaves alone.
8. **What's already here, and the debt** — the issue spec's section
   ([`spec-template.md`](spec-template.md#whats-already-here-and-the-debt)) for the set as a
   whole: what already exists across the area, prior epic-level designs the set keeps, amends
   or supersedes, the set's **Builds on / Adds** table, and the set's net debt. A child's own
   lineage and debt stay in its spec. The compose-existing-pieces rule is
   [`orchestration.md`](orchestration.md#compose-existing-pieces).
9. **Sign off** — one-liners with no figures; the trade-offs stay beside their cards, and only
   the PR body pins them. The goal first, the debt second, then the objective and the
   cross-cutting calls that pass the filters, each linking its card, each with *If wrong:*.
   **Open: none**, or the live forks named.
10. **The facts line** — epic · N issues · project · the objective it serves; sibling links stay on the nav line.
    Last, for the reason a PR body's links line is last: a reader wants it only after deciding
    to go deeper, and above the problem it is a label they must read past
    ([`writing-for-humans.md`](writing-for-humans.md) → "The rule").

> # FIX-770 · Stream resilience: a dropped connection is a non-event
>
> **Spec** · [Decisions](DECISIONS.md)
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
> | **Goal check** | The closure issue's goal check (FIX-782), real model, in an app that sets nothing, on one `main` commit after every other child merges. Its clean run is the epic's wrap condition |
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
> **Docs:** the streaming overview opens by teaching reconnect as something an app gets, not
> something it builds. FIX-776 publishes that opening once heartbeats ship; each child
> documents its own specifics with its implementation.
>
> ## The set · as of 2026-07-05
>
> This table is the reviewed snapshot. Follow its links for live state; the figures point here
> rather than repeating it.
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
>   H["FIX-790 · the store's history read · consumed"] -.-> A
>   A["FIX-775 · resume"] -->|"the cursor and the allocator"| B["FIX-776 · heartbeats"]
>   A -->|"the cursor"| C["FIX-777 · backoff default"]
>   A --> P["FIX-782 · closure · required"]
>   B --> P
>   C --> P
>   A -.->|"found"| X["FIX-781 · partial-frame bug"]
>   classDef done stroke-width:2px
>   class A,X done
> ```
>
> An edge is what one issue hands the next. A dashed input is consumed, not owned, and never
> re-parented; a dashed node that isn't filed yet reads `FIX-XXX · working title` until it is;
> a heavy border is done. Resume goes first. Heartbeats and backoff are the one parallel
> window, and the closure issue waits on all three.
>
> ## What stays as it is
>
> - Client reconnect *policy* beyond the shipped default. The app's.
> - The store. Nothing here serves a response to a client that was never attached.
> - Offline queueing, and any *new* durable history. Both turn a stream into a product-level
>   log, which is a different decision and its own epic.
>
> ## What's already here, and the debt
>
> | Already here | What the set does with it |
> |---|---|
> | Sequence numbers on every item | **Builds on.** Resume and heartbeats both read them |
> | FIX-790's history read for finished requests | **Leaves alone.** Consumed by FIX-775's finished-request boundary, never widened |
> | Apps' own duplicate defences | **Replaces.** An app that does nothing special no longer needs one |
> | FIX-680 D3: each app owns all reconnect machinery | **Amended** for the default by [D3](DECISIONS.md#d3); apps' own policies stay as overrides, not a second reconnect actor |
> | FIX-681's rule against durable per-client state | **Kept**, as [ER-1](DECISIONS.md#who-owns-what) and ER-4 |
>
> | Adds | Existing piece considered | Why it doesn't fit / how composed |
> |---|---|---|
> | One shipped backoff default (FIX-777) | Apps' own reconnect policies | Extends: a default they override in one line. Not a second reconnect actor ([D2](DECISIONS.md#d2), ER-1) |
>
> | The debt | |
> |---|---|
> | **Removes** | The duplicate defence every app writes today; FIX-775 removes the client's own dedupe helper |
> | **Adds** | One shipped backoff default (FIX-777). Permanent by design, and overridable in one line |
> | **Leaves** | Nothing in the set's area that this epic sees and doesn't pay |
>
> **Net: down.** Every app sheds code; the framework gains one default.
>
> ## Sign off
>
> **[The goal](#the-goal-and-how-well-know-its-met), at that size:** dropped *and* silently
> dead, in an app that sets nothing. If wrong: we wrap an epic whose users still hit a dead
> answer, or we carry a closure leg nobody needed.
>
> **[The set's debt](#whats-already-here-and-the-debt), net down:** apps shed their defences,
> the framework gains one default. If wrong: a default nobody can find to override.
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
> **Open: none.** Every question the set raised, and the rules every child obeys, are in
> [DECISIONS.md](DECISIONS.md).
>
> Epic · 4 issues · Streaming · Goal 1, validate through real usage

**Under [`epic-pm`](../../.agents/skills/epic-pm/SKILL.md) the sign-off is stricter**: it
carries that skill's five objective lines — Outcome · Proof · Lead measure · Not doing · Kill
line — and the objective gate is refused without them. **Outcome** and **Proof** are the goal
sentence and *how we verify* above; the other three sit between the teams table and *what's in
the box*. `epic-pm` is canonical for what each line owes.

---

## `DECISIONS.md` — the cross-cutting calls

The calls that sit **above any single issue** — shared surface, naming, sequencing, contracts
two issues both touch — and the rules every child obeys because of them. Same shape as an
issue's decisions ([`spec-template.md`](spec-template.md) → `DECISIONS.md`), with three
epic-only sections. **If it only affects one issue, it isn't a cross-cutting decision.**
Sections, in order:

1. **The tree.**
2. **One card per decision**, anchored, with *Instead of · Because · Locks in*, **what would
   change my mind** on the objective, and its **trade-off figure**, `figures/dN-<slug>.svg`, with
   the sentence naming the row it came down to ([`spec-figures.md`](spec-figures.md) → "The
   trade-off"). Every card on `SPEC.md`'s sign-off has one; the PR body pins only the ones its
   own sign-off lists, which in the PR body example above is D1 and D3.
3. **Who owns what** — the ownership matrix figure: rule × issue, each rule with exactly one
   *decides* or *builds* cell and any number of *consumes* cells. Read a row to see where a
   decision is made, where it's built, and where it's only consumed; a *consumes* cell is a
   place a child must not re-decide. Then **the rules every child obeys**, as a table:
   ER-n · rule · owner · checked at. These are the constraints every child spec and
   implementation must satisfy, and the place a cross-spec review checks. Only this epic's
   rules: what [`orchestration.md`](orchestration.md) already says about running a set is not
   repeated.
4. **Coordination seams** — a table: seam · between · rule. The places two children edit the
   same surface. The closure run exercises each one.
5. **Decided in review, recorded so no child reopens them** — one line each. This is where the
   answers to cross-cutting questions land once they have one.
6. **What the end-state POC showed** — four lines: built · see it · showed · changed. Omit the
   section when the epic built none, and say so in a line.
7. **Analysis** — as an issue's ([`spec-template.md`](spec-template.md) → `DECISIONS.md`),
   at epic altitude: the `adhd` alternatives pass always runs here, so objective 3 names the
   strongest other *division of the set*, not only another design. Its date is the watermark
   the wrap analysis reads.
8. **How it got here** — one line per turn, newest last. A set-table refresh never earns a
   line; a change to the objective or a cross-cutting call always does.

> # FIX-770 · Decisions
>
> [Spec](SPEC.md) · **Decisions**
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
> ![Is resilience worth an epic now: three issues and a closure run, chosen, beside two issues and beside waiting. Decides it: a silently dead connection, which only heartbeats catch. Price: an epic slot. Flips if reconnects are rare enough that apps don't notice](figures/d1-worth-it.svg)
>
> It comes down to a connection that dies silently: without heartbeats, resume never fires.
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
> ![Who reconnects: the client alone, chosen, beside a server-side replay buffer. Decides it: how long the server keeps anything, which has no framework-level answer. Price: no server-initiated recovery](figures/d2-client-only.svg)
>
> It comes down to retention: a buffer needs a rule for how long, and there isn't a good one.
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
> ![Config options: none in the set, chosen, beside a knob per issue. Decides it: who settles a cross-cutting question, the epic or one child. Price: a child that needs a knob stops and comments up](figures/d3-no-knobs.svg)
>
> It comes down to who decides: a knob per issue lets one child settle a question for all four.
>
> ## Who owns what
>
> ![Who owns what: a matrix of five cross-cutting rules by four issues, each rule with exactly one decides or builds cell and consumes cells elsewhere](figures/ownership.svg)
>
> Every rule in the set has one owner. The columns are the chain; read a row to see where a
> decision is made, where it's built, and where it's only consumed. A cell that says *consumes*
> is a place a child must not re-decide.
>
> | # | Rule every child obeys | Owner | Checked at |
> |---|---|---|---|
> | ER-1 | The server holds no per-client state and never initiates a reconnect | FIX-775 (D2) | Every child's spec review |
> | ER-2 | One cursor format, `{requestId}:{sequence}`, across the set; no child adds a second encoding or widens this one | FIX-775 defines · FIX-776, FIX-777 consume | FIX-776's and FIX-777's spec review |
> | ER-3 | No child adds a public config option (D3). A child that needs one comments up | Each child | Every child's spec review |
> | ER-4 | No child retains anything past a request's own lifetime | FIX-775 | The closure run |
> | ER-5 | FIX-790, the store's history read, is consumed and never re-parented under this epic | The coordinator | Each refresh |
>
> ## Coordination seams
>
> | Seam | Between | Rule |
> |---|---|---|
> | The sequence allocator | FIX-775 and FIX-776 | 775 owns it; 776 writes through it. Two allocators and resume skips items |
> | The streaming overview page | FIX-776 and FIX-777 | Both edit it. Whichever lands second links rather than repeats |
>
> ## Decided in review, recorded so no child reopens them
>
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
