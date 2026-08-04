# Epic-spec template — the coordination artifact

An **epic-spec** keeps a set of related issues from being designed in a vacuum. It is
**not** an implementing spec and the issues under it do **not** derive from it — they
*reference and align* to it, and each still writes (or skips) its own spec.

What it is, where it lives, and how it's gated is canonical in
[`orchestration.md`](orchestration.md) → "The epic-spec". The short version:

| | |
|---|---|
| **The epic** | A Linear parent issue carrying the `Epic` label (Kind group); the work is its sub-issues |
| **Where** | `docs/specs/_epics/<name>.md` on branch `epic/<name>`, mirrored to the Epic issue's Linear document |
| **The PR** | Never merged, never deleted. Open for the life of the epic; closes unmerged at wrap |
| **Author** | `epic-agent`, one bounded update per dispatch. It **never starts over** — the doc is the state |
| **The gate** | An approving human comment or review on the epic PR signs off §1 only. Everything else flows continuously and blocks nothing |

**Sign-off certifies the objective, not the plan.** Approving an epic says this body of
work is worth doing and the outcome is the right one. It does not sign off any issue's
approach — that's each spec's own gate — and it is not held open until the themes are
complete. The epic-spec is a direction artifact, so the **same two-round convergence
budget and the same three dispositions** as an issue spec govern its PR. Feedback that
doesn't change the objective or a cross-cutting decision belongs to the issues under it.

**One epic-spec is smaller than one issue spec.** If §2 is longer than the specs it
coordinates, it has stopped being a coordination artifact and started being a design
nobody signed off. Cross-cutting decisions only.

**How to read the rest of this file.** Every section is one line of instruction followed
by a worked example. The example is one imaginary epic — stream resilience, three
sub-issues — so it reads end to end. Copy the shape, not the content.

---

## For reviewers — what this document is

*(Paste verbatim at the top of the epic PR description, the same way a spec PR carries
its own contract. Most epic-PR review is automated reviewers we can't instruct. This is the
**static** half; the description also carries a **per-PR** "Parts worth reviewing closely"
block — see [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md), canonical for both.)*

This is an **epic-spec**: the shared objective and cross-cutting decisions for a *set* of
issues. It is not an implementation plan and it is not any one issue's design.

**In scope to challenge:**

- The objective — is this body of work worth doing, and is the outcome the right one?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too
  much. That question can only be asked here.
- A cross-cutting decision in §2 — shared surface, naming, sequencing, contracts.
- A missing issue the objective implies, or one in the set that doesn't serve it.

**Out of scope — owned by the individual issue specs:**

- Any single issue's approach, architecture, file layout, or test plan.
- Anything that touches exactly one issue. It belongs on that issue's spec PR.
- **Any POC files on this branch, entirely.** This PR is never merged, so it may carry a
  throwaway end-state POC built to show what the set looks like once every issue has landed
  ([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)). None of it ships. React to the
  *shape and the scoping it reveals* — §3 summarizes what it showed — and don't review it as
  code.

Feedback in the second list is routed to the issue it concerns as an implementer note,
not folded in here.

---

## Parts worth reviewing closely

*(Authored fresh each time the epic PR is opened or its objective materially changes. 1–3
items at **epic altitude** — the objective, the set's composition, a cross-cutting decision.
Rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

> **1. §1 — whether this is three issues or two.** FIX-777 (backoff defaults) is the one I'd
> cut. It's kept and scoped down, and the reasoning is in §1. The question: does shipping a
> default with no knobs actually serve the objective, or is it a config line we're dressing
> up as resilience? A wrong answer here costs a whole issue's work.
>
> **2. Theme 4 — the client is the only reconnect actor.** Two issues depend on it silently.
> If it falls, the epic's *scope* changes rather than one issue's design, which is why it's
> stated here and not in a spec.
>
> **Where I'm unsure:** the sequencing in theme 3. FIX-775 merging first is clearly right;
> whether 776 and 777 can genuinely be *specced* in parallel against a cursor that doesn't
> exist yet is a guess.

---

## 1. Purpose & objective *(the gated sign-off surface)*

Why this body of work, and what outcome it produces — abstract, no per-issue detail.
Then the **holistic necessity check**: the `issue-spec` Step 3.5 lens raised to the set.
Each issue can earn its place while the whole overbuilds; this is the only place that's
visible. Say what the set is deliberately *not* doing.

> **Objective.** Make a dropped connection a non-event for an app built on FSD.
> Today, every network blip is visible to the end user as duplicated output and
> to the app author as a stream it has to defend against by hand. When this epic
> lands, an app that does nothing special survives a reconnect.
>
> **Holistic necessity.** Three issues, and the honest question is whether it's
> two. Resume (FIX-775) is the substance. Heartbeats (FIX-776) exist to make
> reconnects *detectable* — without it, a silently dead connection isn't
> reconnected at all, so resume never fires and the epic doesn't deliver its
> outcome. Backoff policy (FIX-777) is the weakest of the three: apps can set
> their own, and shipping a default mostly saves a config line. **Kept, scoped
> down** to a default with no new options — if it grows a knob during
> implementation, that's the signal it should have been dropped.
>
> **Not doing:** offline queueing, or any *new* durable history — serving a
> response to a client that was never attached, or retaining anything past the
> request's own lifetime. Both turn a stream into a product-level log, which is a
> different decision and its own epic. (Replaying a request's *existing* persisted
> log to a client reattaching to it is in scope — that's FIX-775's decision 3. An
> epic non-goal that swallows a child's decision is how a cross-spec pass ends up
> deleting work the set requires.)

## 2. Themes & long-horizon direction

The decisions that sit **above any single issue** — shared surface, naming, sequencing,
contracts two issues both touch. Numbered, so an issue spec can cite one. Each: the
decision and what it constrains in the issues below. **If it only affects one issue, it
isn't a theme.**

> 1. **One cursor format across the epic: `{requestId}:{sequence}`.** FIX-775
>    defines it; FIX-776 and FIX-777 consume it as-is. No issue invents a second
>    encoding, and no issue widens it without changing this line first.
>
> 2. **Nothing in this epic adds a public config option.** Resilience is a
>    property of the transport, not something an app opts into. An issue that
>    finds it needs a knob has hit a cross-cutting question — comment up on this
>    PR rather than deciding it locally.
>
> 3. **Sequencing: FIX-775 lands first.** The other two are meaningless without a
>    cursor to carry. They can be *specced* in parallel; they can't merge first.
>
> 4. **The client is the only reconnect actor.** The server holds no per-client
>    state and never initiates. This is what keeps resume from needing retention
>    rules, and it is the decision most likely to be argued — if it falls, the
>    epic's scope changes rather than one issue's design.

## 3. Shape of the whole *(POC — omit the section when the epic built none)*

The one thing only this altitude can check: **what the set looks like once every issue has
landed.** Each issue can be individually sound while the assembled surface is wrong — a
seam two issues both want to own, a division that puts one decision in two places, an
end-state nobody would have chosen if they'd seen it. A rough end-state POC on the epic
branch makes that visible *before* the objective gate. Built under
[`spec-poc`](../../.agents/skills/spec-poc/SKILL.md) when a trigger fires; the default is
none, and "the shape is obvious" is a legitimate reason to skip.

Four lines, not a report: **what was built · where to see it · what it showed · what
changed because of it.** A POC that changed nothing still gets its line — that a premise
survived contact with code is worth knowing.

> **Built:** all three issues' surfaces sketched together end to end, rough and unshipped
> — a cursor on the stream seam, heartbeat frames, and a client that reconnects — driven by
> one throwaway flow.
> **See it:** `poc/epic-stream-resilience/` on this branch. `pnpm poc:stream-resilience`
> prints the assembled reconnect transcript.
> **Showed:** heartbeats and resume both want to write through the sequence allocator, and
> each issue read alone puts that decision in its own file. Considered separately they'd
> have shipped two allocators.
> **Changed:** added theme 1's "one cursor format" as a *constraint on the allocator*, not
> just on the encoding, and moved sequence allocation into FIX-775's scope so 776 consumes
> it. Without the POC that surfaces as a merge conflict in week three.

## 4. Running index

The durable audit log — every issue under the epic and every PR it produced, so a human
or an agent navigates the set from one place. Refreshed from the coordinator's status
table; it is a projection, not a second live source. **Keep it a table, not prose.**

> | Issue | What it delivers | Route | Spec PR | Impl PR | State |
> |---|---|---|---|---|---|
> | FIX-775 | Resume from a sequence cursor | spec | [#812](https://github.com/o/r/pull/812) | [#830](https://github.com/o/r/pull/830) | In Review |
> | FIX-776 | Heartbeat frames so a dead connection is detectable | spec | [#815](https://github.com/o/r/pull/815) | — | In Spec Review |
> | FIX-777 | Default reconnect backoff in the client | spec | — | — | Needs spec |
> | FIX-781 | Reconnect drops the last partial frame | **bug** | — | [#833](https://github.com/o/r/pull/833) | In Review |
>
> *A bug carries no spec PR by design — it routes straight to implementation
> ([`orchestration.md`](orchestration.md) → "Which issues get a spec"). An empty
> Spec PR cell on a `bug` row is correct, not a gap.*

## 5. Open cross-cutting questions

Questions raised by epic-PR review, or by an issue commenting **up**, that no single
issue can answer. Each: the question, who raised it, what it blocks (usually nothing),
and the resolution once it lands. **Resolved ones stay, with their answer** — that's what
stops a third issue reopening them.

> - **Do heartbeat frames consume sequence numbers?** Raised by FIX-776's spec,
>   commenting up. It changes FIX-775's filter, so neither issue can settle it
>   alone. Blocks nothing — both proceed on "no" and fold if the POC in flight
>   comes back otherwise.
> - **~~Should the cursor be opaque to clients?~~** *Resolved:* no. Making it
>   opaque means the server keeps a mapping, which reintroduces the per-client
>   state theme 4 exists to avoid. Raised by review on this PR, decided here.

---

## Epic evolution

One line per meaningful turn, **newest last** — same rule and format as a spec's:
`- **<trigger>** — <what changed>, because <why>.` A running index refresh doesn't earn
a line; a change to the objective or a theme always does.

> - **Epic drafted** — three issues under one outcome: a dropped connection is a
>   non-event. Scoped backoff down to a default with no options.
> - **After epic review** — added theme 4 (the client is the only reconnect actor),
>   because two issue specs had each assumed it silently and one had assumed the
>   opposite.
> - **After FIX-776 commented up** — sequencing theme now says FIX-775 merges
>   first, because heartbeats can't be specced against a cursor that doesn't exist.
