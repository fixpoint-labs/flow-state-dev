# Epic-spec template — the coordination artifact, as a set

An **epic-spec** keeps a set of related issues from being designed in a vacuum. It is **not** an
implementing spec and the issues under it do **not** derive from it — they *reference and align*
to it, and each still writes (or skips) its own spec.

What it is, where it lives, and how it's gated is canonical in
[`orchestration.md`](orchestration.md) → "The epic-spec". The short version:

| | |
|---|---|
| **The epic** | A Linear parent issue carrying the `Epic` label (Kind group); the work is its sub-issues |
| **Where** | `spec/_epics/<name>/` on branch `epic/<name>`, mirrored to the Epic issue's Linear document |
| **The PR** | Never merged, never deleted. Open for the life of the epic; closes unmerged at wrap |
| **Author** | `epic-agent`, one bounded update per dispatch. It **never starts over** — the set is the state |
| **The gate** | An approving human comment, review, or the owner's `epic approved` label on the epic PR signs off the objective only. Everything else flows continuously and blocks nothing |
| **Refreshed** | For the life of the epic: the set table, the dependency graph, the path figure and the PR body move as issues are filed and finish |

**Sign-off certifies the objective, not the plan.** Approving an epic says this body of work is
worth doing and the outcome is the right one. It does not sign off any issue's approach — that's
each spec's own gate. The epic-spec is a direction artifact, so the **same two-round convergence
budget and the same three dispositions** as an issue spec govern its PR. Feedback that doesn't
change the objective or a cross-cutting decision belongs to the issues under it.

**The same four documents as an issue spec, at a different altitude.** The shape is
[`spec-template.md`](spec-template.md)'s; what each document carries changes with the altitude,
and the change is the whole of this file:

| File | At issue altitude | At epic altitude | Budget |
|---|---|---|---|
| `SPEC.md` | What changes, for whom | The objective as before/after for the **teams** who feel it · **what's in the box** as one figure · **the set, with live status** · **the dependency graph** · what stays as it is · sign-off on the objective | ~900 |
| `DECISIONS.md` | D-n cards, the tree | The **cross-cutting calls** as cards · an **ownership matrix** of rule × issue · what was **decided in review** so no child reopens it · what the end-state POC showed | ~1,300 |
| `BUSINESS-RULES.md` | BR-n: when → then → proved by | **ER-n: the rules every child obeys**, with owner and where each is checked · what no child may do · how the set is run · what done means | ~800 |
| `PLAN.md` | Surfaces, DAG, checks, guardrails — for the implementer | **Sequencing, not building**: **the path** as lanes against time · what each issue consumes, delivers and releases · what unblocks what · coordination seams · not-children · the wrap | ~900 |
| `figures/` | One figure the PR body carries | Three the PR body carries: the box, the ownership matrix, the path | — |

**The nav line is the same at both altitudes.** The third line of every document is
`[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)` with
the current one bold and unlinked ([`spec-template.md`](spec-template.md)), so a reader who lands
on the rules from a child's spec PR can flip to the decisions without climbing to the directory.

**The plan is the document that changes most.** An issue plan says how to build one thing; an
epic plan says what order N things run in, what each one entails, and what each hands the next.
So its figure is time, not structure. It has no checks column, because each child's plan owns
those.

**Status lives in the spec, once.** The set table in `SPEC.md` carries every issue's state and PR
links, and it is refreshed on the epic PR as issues move; the plan and the figures point at it
rather than repeating it. The dependency graph sits beside it as mermaid because it is the thing
edited most: an epic spec usually causes its issues to be filed, so a node for an issue that
doesn't exist yet is a **`FIX-XXX · working title`** placeholder, drawn dashed, that gets its
real id when filed and a heavy border when done ([`spec-figures.md`](spec-figures.md) → "The
placeholder convention"). The path figure is redrawn at the same moments.

**One epic-spec is smaller than one issue spec** in what it decides. If `DECISIONS.md` is longer
than the specs it coordinates, it has stopped being a coordination artifact and started being a
design nobody signed off. Cross-cutting decisions only.

**Where the old sections went:**

| Was | Now |
|---|---|
| §1 Purpose & objective, the holistic necessity check | `SPEC.md` — the teams table, *what's in the box*, the set with *why the set needs it*, the sign-off |
| §2 Themes | `DECISIONS.md` — the cross-cutting calls as cards, and *decided in review* |
| §3 Shape of the whole (the POC) | `DECISIONS.md` — *what the end-state POC showed*, four lines |
| §4 Running index | `SPEC.md` — the set table, now with status and PR links, refreshed for the epic's life |
| §5 Open cross-cutting questions | `DECISIONS.md` — *decided in review* once answered; a live one is an ask in the PR body |
| The explainer | Retired. Its panels are the box figure, the set table, the ownership matrix and the path |

**How to read the rest of this file.** Every document is its instruction followed by a worked
example. The example is one imaginary epic — stream resilience, three sub-issues and a proof —
so it reads end to end. Copy the shape, not the content.

---

## How to review this

*(Paste verbatim into the epic PR description's collapsed `<details>` block, the same way a spec
PR carries its own contract. Most epic-PR review is automated reviewers we can't instruct, and
this text is identical on every epic PR — so it sits **below the fold**. The visible half is
authored per PR. Layout and rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

This is an **epic-spec**: the shared objective and cross-cutting decisions for a *set* of
issues, in four documents. It is not an implementation plan and it is not any one issue's design.

**In scope to challenge:**

- The objective — is this body of work worth doing, and is the outcome the right one?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too much.
  That question can only be asked here.
- A cross-cutting decision in `DECISIONS.md` — shared surface, naming, sequencing, contracts.
- A rule in `BUSINESS-RULES.md` with no owner, or two.
- A missing issue the objective implies, or one in the set that doesn't serve it.

**Out of scope — owned by the individual issue specs:**

- Any single issue's approach, architecture, file layout, or test plan.
- Anything that touches exactly one issue. It belongs on that issue's spec PR.
- **The figures, at the pixel level**, and **the status in the set table**, which is refreshed
  as the set moves and is never a review finding.
- **Any POC files on this branch, entirely.** This PR is never merged, so it may carry a
  throwaway end-state POC built to show what the set looks like once every issue has landed
  ([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)). None of it ships. React to the
  *shape and the scoping it reveals* — `DECISIONS.md` summarizes what it showed — and don't
  review it as code.

Feedback in the second list is routed to the issue it concerns as an implementer note, not
folded in here.

---

## The PR body

*(Authored when the epic PR opens; the status line and the figure pins are refreshed for the
life of the epic, the rest whenever the objective materially changes. Budget ~450 prose words
above the fold. Rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

The teams table from `SPEC.md`. **What's in the box**, pinned, with its sentence. **Why now.**
**The set** in one line each, with the as-of status counts and a link to the live table. **The
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
> <img src="…/<sha>/spec/_epics/<name>/figures/end-state.svg" width="940" alt="What's in the box: resume and heartbeats; composed in by the app: reconnect policy; not built: offline queueing and a durable history" />
>
> Inside the box is what an app gets for nothing. The fence keeps a stream from becoming a store.
>
> **Why now.** Mobile is the first thing every app built on FSD ships to, and every one of them
> is re-implementing the defence.
>
> **The set:** three issues and a proof. Resume, heartbeats, a backoff default, and a required
> goal check that drops a real connection. As of 2026-07-05: 1 done, 2 in flight, 1 not
> filed; the live table and the dependency graph are in [the spec](SPEC.md#the-set--as-of-2026-07-05).
>
> <img src="…/<sha>/spec/_epics/<name>/figures/path.svg" width="940" alt="The path: one lane per issue against time, resume done, heartbeats and backoff in flight at the now line, the proof lane empty until both land" />
>
> Redrawn on this PR as the set moves. Heartbeats and backoff are the one parallel window.
>
> <img src="…/<sha>/spec/_epics/<name>/figures/ownership.svg" width="940" alt="Who owns what: five cross-cutting rules by four issues, each rule with exactly one owner" />
>
> Every rule has one owner. Two would be a seam; none would be a gap.
>
> ## Sign off
>
> 1. **A dropped connection is worth three issues and a proof, now.** If wrong: a cycle on
>    resilience nobody notices, which the proof exists to make impossible to miss.
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
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)
> · Linear FIX-770 · Project: Streaming · **never merges**, open for the life of the epic
>
> <details>
> <summary><b>How to review this</b> — an epic-spec, not an implementation plan</summary>
>
> *(the block above, verbatim)*
>
> </details>
> ```

**The as-of line and the three image pins are refreshed by every epic-agent update**, in the
same commit as the set table. A body that says *1 done* under a table that says *3 done* is the
defect the single live table exists to prevent. Where a person has pasted an image into the body,
the tool leaves it and the refresh names the pin the person changes
([`spec-figures.md`](spec-figures.md) → "In the PR body").

---

## `SPEC.md` — the objective, the box, the set

The document the product owner reads at the gate and everyone reads when they arrive mid-epic.
Sections, in order:

1. **The header line** — epic · N issues · project · the objective it serves, and the links.
2. **Teams, before and after** — a table: a team that… · today · after this epic. Three to
   five rows. This is the objective stated in observable behaviour.
3. **Why now**, in a paragraph.
4. **What's in the box** — the one figure: in the box · composed in by the app · replaced in
   one line · not built. And its sentence.
5. **The set · as of `<date>`** — the live table: issue · what it delivers · why the set needs
   it · status with PR links. Then the counts line and the holistic necessity check in a
   paragraph: whether N is really N−1, and the collapse trigger if one was named. **A bug row
   carries no spec PR by design** ([`orchestration.md`](orchestration.md) → "Which issues get
   a spec"); an empty cell there is correct.
6. **How the issues flow into each other** — the dependency graph as mermaid, edges labelled
   with what one issue hands the next, inputs from other epics dashed, unfiled issues as
   placeholders. Then the legend sentence.
7. **What stays as it is** — the neighbours the set deliberately leaves alone.
8. **Sign off** — the objective and the cross-cutting calls that pass the filters, each linking
   its card, each with *If wrong:*. **Open: none**, or the live forks named.

> # FIX-770 · Stream resilience: a dropped connection is a non-event
>
> **Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)
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
> | FIX-XXX · reconnect proof · **required** | One real client dropped mid-stream on the real path, asserted on the transcript | The only child shaped to move Goal 1 | Not filed · waits on FIX-776 and FIX-777 |
> | FIX-781 | Reconnect drops the last partial frame | A **bug** found by FIX-775's goal check | Fixed · [#833](https://github.com/o/r/pull/833) |
>
> 2 done · 2 in flight · 1 not filed. Three are substance, one is the proof, one was a bug the
> proof found. Whether three is really two was argued at the gate: FIX-777 stays, scoped to a
> default with no options, and the collapse trigger is a knob.
>
> ## How the issues flow into each other
>
> ```mermaid
> flowchart LR
>   A["FIX-775 · resume"] -->|"the cursor"| B["FIX-776 · heartbeats"]
>   A -->|"the cursor"| C["FIX-777 · backoff default"]
>   B --> P["FIX-XXX · reconnect proof · required"]
>   C --> P
>   A -.->|"found"| X["FIX-781 · partial-frame bug"]
>   classDef done stroke-width:2px
>   classDef proposed stroke-dasharray:4 3
>   class A,X done
>   class P proposed
> ```
>
> An edge is what one issue hands the next. A dashed node isn't filed yet and reads `FIX-XXX ·
> working title` until it is; a heavy border is done. Only heartbeats and backoff ever run in
> parallel, and the proof waits on both.
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
> 1. **[D1](DECISIONS.md#d1) · A dropped connection is worth three issues and a proof, now.**
>    If wrong: a cycle on resilience nobody notices, which the proof exists to make impossible
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
line — and the objective gate is refused without them. They sit between the teams table and *what's
in the box*; `epic-pm` is canonical for what each line owes.

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
> [Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)
>
> The calls that sit above any single issue: what was chosen, what lost, why, and what each
> locks in for the four issues under it. Three are the sign-off surface. The rest were raised
> in review and are recorded so no child reopens them.
>
> ## The tree
>
> ```mermaid
> flowchart TD
>   E["FIX-770"] --> D1["D1 · three issues and a proof, now"]
>   D1 -.->|"rejected"| X1["two · drop the backoff default"]
>   E --> D2["D2 · the client is the only reconnect actor"]
>   D2 -.->|"rejected"| X2["server-side session replay buffer"]
>   E --> D3["D3 · no public config option anywhere in the set"]
>   D3 -.->|"rejected"| X3["a knob per issue"]
> ```
>
> <a name="d1"></a>
> ## D1 · A dropped connection is worth three issues and a proof, delivered now
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
> throwaway flow. **See it:** `spec-poc/epic-stream-resilience/` on this branch;
> `pnpm tsx spec-poc/epic-stream-resilience/run.ts` prints the assembled reconnect transcript.
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
no child may do · how the set is run · the proof (what done means).

> # FIX-770 · Rules every issue in the set obeys
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)
>
> At epic altitude the rules aren't behaviours of one feature; they're the constraints every
> child spec and implementation must satisfy, and the place a cross-spec review checks. Each
> says who owns it and where it's checked.
>
> ## What a team gets, and what it doesn't
>
> | # | Rule | Owner | Checked at |
> |---|---|---|---|
> | ER-1 | A client that drops mid-stream and reconnects assembles the uninterrupted transcript, item for item | FIX-775 | The proof's goal check |
> | ER-2 | A silently dead connection is detected within one heartbeat interval | FIX-776 | FIX-776's tests · the proof |
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
> | ER-11 | A cross-cutting question a child hits is commented **up** on the epic PR, not decided locally | The decisions doc is the single place; a local answer is a second authority |
> | ER-12 | Every child's route reads *spec* by default; only a `Bug` label re-routes it | Fail-closed routing |
> | ER-13 | The epic finishes only when the proof's goal check passes | D1. Surface without proof doesn't move the lead measure |
>
> ## The proof
>
> | # | The epic is done when | Proved by |
> |---|---|---|
> | ER-14 | A real client, on the real path, drops mid-stream and reconnects, and the transcript has no gap and no duplicate | The proof issue's goal check, real model |
> | ER-15 | The docs teach reconnect as something an app gets, not something it builds | FIX-776's docs PR: the streaming overview leads with it |

---

## `PLAN.md` — sequencing, not building

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. Sections, in order:

1. **The path** — the one figure: one lane per issue in chain order, inputs from other epics as
   lanes above, done bars, in-flight bars at the now line, empty lanes after it, the critical
   path drawn through. And its sentence. **Redrawn whenever the set table moves.**
2. **What each issue entails** — a table: issue · route · consumes · delivers · releases · size.
   *Consumes → delivers → releases* is the row an issue plan never needs and an epic plan can't
   do without.
3. **Where it is** — a pointer at the spec's live table, plus the inputs from other epics and
   their verified state. Never a second copy of the table.
4. **What unblocks what, from here** — numbered: this merges → that can start.
5. **Coordination seams to watch** — a table: seam · between · rule. The places two children
   edit the same surface.
6. **Not children, deliberately** — the linked issues that are consumed, not owned.
7. **Wrap** — what happens when the proof holds.

> # FIX-770 · Plan
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**
>
> An epic plan sequences the work and says what each piece entails. It does not say how to
> build any piece; that's each issue's own plan. IDs cross-reference
> [DECISIONS.md](DECISIONS.md) (D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).
>
> ## The path
>
> ![Swimlanes against time: one input lane from the store epic, four issue lanes in chain order, a done bar for resume, in-flight bars for heartbeats and backoff at the now line, an empty proof lane after them, and the critical path drawn through resume, heartbeats and the proof](figures/path.svg)
>
> A chain with one fork. Only resume could start at the gate. The one parallel window is
> heartbeats beside backoff once the cursor exists, and that's where the set is now. Required
> does not move the proof earlier: it waits on both. The dependency graph itself is in
> [the spec](SPEC.md#how-the-issues-flow-into-each-other); this document adds time to it.
>
> ## What each issue entails
>
> | Issue | Route | Consumes | Delivers | Releases | Size |
> |---|---|---|---|---|---|
> | **FIX-775** resume | spec → impl PR | The existing sequence numbers · D2 | The cursor, the seam filter, the completed-request boundary, the one allocator | FIX-776 · FIX-777 | Medium |
> | **FIX-776** heartbeats | spec → impl PR | The cursor · the allocator (ER-5) | Heartbeat frames that don't consume sequence numbers; the docs lead | The proof (with 777) | Small |
> | **FIX-777** backoff default | spec → impl PR | The cursor · D3 | One default, no options, one-line override | The proof (with 776) | Small |
> | **FIX-XXX** reconnect proof · required | spec → goal check | Resume · heartbeats · the default | One real drop on the real path, asserted on the transcript | The epic's wrap | Small |
>
> ## Where it is
>
> Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-07-05).
> The swimlanes above carry the same state as a picture of time and are redrawn when it moves.
> The one input from another epic: FIX-790, the store's history read, is shipped and ER-9
> consumes it without re-parenting it.
>
> ## What unblocks what, from here
>
> 1. **FIX-776 and FIX-777 merge** → the proof is filed and can start. Nothing else waits on them.
> 2. **The proof's goal check passes** → the epic wraps: lessons pass, docs polish, the epic PR
>    closes unmerged.
> 3. **If FIX-790's read gains a `from` option during any of this** → FIX-775's seam is
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
> When ER-13 holds: run the lessons pass over the set's review rounds, dispatch the docs polish
> over the streaming pages the children each edited in isolation, refresh the spec's set table
> and the path one last time, and close the epic PR unmerged.

---

## What refreshes, and when

The epic-spec is the one spec that is edited for its whole life. `epic-agent` owns every edit,
one bounded update per dispatch, and the coordinator dispatches it on these triggers
(`epic-lifecycle` → the loop; `epic-wake` fires the refresh when a row's phase changed):

| Trigger | `SPEC.md` | `DECISIONS.md` | `PLAN.md` | The PR body |
|---|---|---|---|---|
| An issue is filed, or its spec PR opens | Set table row · graph node gets its id, solid border | — | Path lane gets a bar | As-of line · path pin |
| A spec is approved, an impl PR opens or merges | Set table status · graph border goes heavy on done | — | Path bars and now line | As-of line · path pin |
| A cross-cutting question is answered, or a POC verdict lands | — | The card or *decided in review* · ownership matrix if an owner moved | — | The affected block |
| Review folds a change to the objective | Teams table · box figure if the box changed | The card · *how it got here* | — | Blocks 1–3 · box pin |
| Wrap | Set table final · counts line | *How it got here* final line | Path final | As-of line · path pin |

Two things about that table. **A status refresh is a commit on the epic PR**, so it moves the
head: a review-based objective approval goes stale on it by the ordinary staleness rule, and the
owner's `epic approved` label — standing state that survives pushes — is the channel built for a
PR that takes commits for its whole life ([`orchestration.md`](orchestration.md) → Gates). **A
refresh that changes nothing is a real outcome**: say so and exit rather than manufacturing a
diff.

---

## Publishing and mirroring

The directory is committed to `epic/<name>` and opened as the never-merged epic PR. The Linear
document attached to the Epic issue is **the four files in reading order** under their own H1s,
figures linked to the branch (`https://github.com/<owner>/<repo>/blob/epic/<name>/spec/_epics/<name>/figures/<name>.svg`)
and every cross-document link (`DECISIONS.md#d4`, `PLAN.md`) rewritten to the same branch URL,
re-mirrored on every refresh. Linear renders neither `<details>` nor a repo-relative image, so
the document carries links and the ordering carries the fold.
